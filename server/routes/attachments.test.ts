/**
 * @vitest-environment node
 *
 * See server/storage/filesystem.test.ts's docblock: this repo's vitest.config.ts
 * defaults to jsdom, whose global File/Blob lack arrayBuffer()/stream() —
 * forcing the real Node environment here (matching origin/feat/PAN-7819's
 * own attachments.test.ts) restores real File/Blob for the multipart body
 * construction below. Production code is unaffected — it never runs under jsdom.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigration } from "../db/migrate.js";
import { registerAttachmentRoutes } from "./attachments.js";
import { FilesystemStorage } from "../storage/filesystem.js";

function insertItem(db: Database.Database, id: string) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "decision_request", `Item ${id}`, "open", now, now);
}

interface MultipartRequest {
  headers: Record<string, string>;
  payload: Buffer;
}

/** Builds a real multipart/form-data body using Node's global FormData/File/Response —
 *  no extra devDependency needed (form-data package isn't a direct dep of this repo). */
async function buildMultipart(
  fields: Record<string, string>,
  file?: { field: string; filename: string; content: string | Buffer; type: string },
): Promise<MultipartRequest> {
  const form = new FormData();
  // Value fields are appended before the file field deliberately — busboy
  // (which @fastify/multipart wraps) parses multipart in stream order, and
  // fields placed before the file part are guaranteed to be available
  // without needing to fully drain the file stream first.
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  if (file) {
    const bytes = typeof file.content === "string" ? Buffer.from(file.content) : file.content;
    form.append(file.field, new File([bytes], file.filename, { type: file.type }));
  }
  const response = new Response(form);
  const contentType = response.headers.get("content-type")!;
  const payload = Buffer.from(await response.arrayBuffer());
  return { headers: { "content-type": contentType }, payload };
}

describe("Attachment routes", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");

    tmpDir = mkdtempSync(join(tmpdir(), "consus-attachments-test-"));
    const storageAdapter = new FilesystemStorage(tmpDir);

    app = Fastify({ logger: false });
    registerAttachmentRoutes(app, { db, storageAdapter });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("POST /api/items/:id/attachments", () => {
    it("stores the file under the configured storage dir, inserts a row with the real actor, and returns 201 with metadata", async () => {
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "screenshot.png", content: "fake png bytes", type: "image/png" },
      );

      const res = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.item_id).toBe("item-1");
      expect(body.file_name).toBe("screenshot.png");
      expect(body.mime_type).toBe("image/png");
      expect(body.size).toBe(Buffer.byteLength("fake png bytes"));
      expect(body.id).toBeTruthy();
      expect(body.created_at).toBeTruthy();

      const row = db.prepare("SELECT * FROM attachments WHERE id = ?").get(body.id) as
        | { actor: string; item_id: string }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.actor).toBe("mathew");
      expect(row!.actor).not.toBe("authenticated_user");

      expect(readdirSync(tmpDir).length).toBe(1);
    });

    it("never trusts the client-supplied multipart mimetype — stores/serves the extension-derived type instead (grill finding: stored-XSS via a spoofed Content-Type)", async () => {
      // A .png filename (passes the extension allowlist) but a spoofed
      // type claiming text/html — pre-fix, this would have been stored
      // verbatim and replayed as the served Content-Type with
      // Content-Disposition: inline, letting the response execute as HTML
      // if the raw attachment URL were opened directly.
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "cute-cat.png", content: "<script>document.title='pwned'</script>", type: "text/html" },
      );

      const res = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });

      expect(res.statusCode).toBe(201);
      expect(res.json().mime_type).toBe("image/png");

      const row = db.prepare("SELECT mime_type FROM attachments WHERE id = ?").get(res.json().id) as {
        mime_type: string;
      };
      expect(row.mime_type).toBe("image/png");
      expect(row.mime_type).not.toBe("text/html");
    });

    it("returns 404 and writes no file / no row when the item does not exist", async () => {
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "a.txt", content: "hi", type: "text/plain" },
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/items/does-not-exist/attachments",
        headers,
        payload,
      });

      expect(res.statusCode).toBe(404);
      expect(existsSync(tmpDir) ? readdirSync(tmpDir).length : 0).toBe(0);
      const count = db.prepare("SELECT COUNT(*) AS n FROM attachments").get() as { n: number };
      expect(count.n).toBe(0);
    });

    it("returns 400 and writes no file / no row for a disallowed extension", async () => {
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "virus.exe", content: "bad payload", type: "application/x-msdownload" },
      );

      const res = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });

      expect(res.statusCode).toBe(400);
      expect(existsSync(tmpDir) ? readdirSync(tmpDir).length : 0).toBe(0);
      const count = db.prepare("SELECT COUNT(*) AS n FROM attachments").get() as { n: number };
      expect(count.n).toBe(0);
    });

    it("returns 413 for a file over 10MB", async () => {
      const big = Buffer.alloc(10 * 1024 * 1024 + 1, "a");
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "big.txt", content: big, type: "text/plain" },
      );

      const res = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });

      expect(res.statusCode).toBe(413);
      const count = db.prepare("SELECT COUNT(*) AS n FROM attachments").get() as { n: number };
      expect(count.n).toBe(0);
    });

    it("returns 400 when the required actor field is missing (never falls back to a hardcoded placeholder)", async () => {
      const { headers, payload } = await buildMultipart(
        {},
        { field: "file", filename: "a.txt", content: "hi", type: "text/plain" },
      );

      const res = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });

      expect(res.statusCode).toBe(400);
      const count = db.prepare("SELECT COUNT(*) AS n FROM attachments").get() as { n: number };
      expect(count.n).toBe(0);
    });
  });

  describe("GET /api/items/:id/attachments", () => {
    it("lists all non-deleted attachments for the item, excludes soft-deleted ones, in stable (created_at ASC) order", async () => {
      const upload1 = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "one.txt", content: "one", type: "text/plain" },
      );
      const res1 = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", ...upload1 });
      const id1 = res1.json().id;

      const upload2 = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "two.txt", content: "two", type: "text/plain" },
      );
      const res2 = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", ...upload2 });
      const id2 = res2.json().id;

      const upload3 = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "three.txt", content: "three", type: "text/plain" },
      );
      const res3 = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", ...upload3 });
      const id3 = res3.json().id;

      // soft-delete the middle one
      await app.inject({ method: "DELETE", url: `/api/attachments/${id2}` });

      const listRes = await app.inject({ method: "GET", url: "/api/items/item-1/attachments" });
      expect(listRes.statusCode).toBe(200);
      const body = listRes.json() as Array<{ id: string; created_at: string; file_name: string }>;

      expect(body.map((a) => a.id)).toEqual([id1, id3]);
      expect(body.map((a) => a.file_name)).toEqual(["one.txt", "three.txt"]);

      // stable order: created_at is non-decreasing
      const timestamps = body.map((a) => a.created_at);
      const sorted = [...timestamps].sort();
      expect(timestamps).toEqual(sorted);
    });

    it("returns an empty list for an item with no attachments", async () => {
      const res = await app.inject({ method: "GET", url: "/api/items/item-1/attachments" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("GET /api/attachments/:id", () => {
    it("streams back the file bytes with the correct Content-Type and a Content-Disposition naming the original filename", async () => {
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "notes.txt", content: "hello attachment", type: "text/plain" },
      );
      const uploadRes = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });
      const { id } = uploadRes.json();

      const res = await app.inject({ method: "GET", url: `/api/attachments/${id}` });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.headers["content-disposition"]).toContain("notes.txt");
      expect(res.body).toBe("hello attachment");
    });

    it("sets X-Content-Type-Options: nosniff and forces Content-Disposition: attachment for a non-inline-safe type, even though the served Content-Type is already a safe, server-derived value (defense in depth)", async () => {
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "notes.txt", content: "hello", type: "text/plain" },
      );
      const uploadRes = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });
      const { id } = uploadRes.json();

      const res = await app.inject({ method: "GET", url: `/api/attachments/${id}` });

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    });

    it("serves an inline-safe type (image) with Content-Disposition: inline", async () => {
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "shot.png", content: "fake png bytes", type: "image/png" },
      );
      const uploadRes = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });
      const { id } = uploadRes.json();

      const res = await app.inject({ method: "GET", url: `/api/attachments/${id}` });

      expect(res.headers["content-disposition"]).toMatch(/^inline;/);
    });

    it("returns 404 for an attachment id that never existed", async () => {
      const res = await app.inject({ method: "GET", url: "/api/attachments/does-not-exist" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for a soft-deleted attachment", async () => {
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "gone.txt", content: "bye", type: "text/plain" },
      );
      const uploadRes = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });
      const { id } = uploadRes.json();

      await app.inject({ method: "DELETE", url: `/api/attachments/${id}` });

      const res = await app.inject({ method: "GET", url: `/api/attachments/${id}` });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/attachments/:id", () => {
    it("soft-deletes: sets deleted_at, returns 204, and the attachment is excluded from subsequent GET/list", async () => {
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "del.txt", content: "delete me", type: "text/plain" },
      );
      const uploadRes = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });
      const { id } = uploadRes.json();

      const deleteRes = await app.inject({ method: "DELETE", url: `/api/attachments/${id}` });
      expect(deleteRes.statusCode).toBe(204);

      const row = db.prepare("SELECT deleted_at FROM attachments WHERE id = ?").get(id) as {
        deleted_at: string | null;
      };
      expect(row.deleted_at).not.toBeNull();

      const downloadRes = await app.inject({ method: "GET", url: `/api/attachments/${id}` });
      expect(downloadRes.statusCode).toBe(404);

      const listRes = await app.inject({ method: "GET", url: "/api/items/item-1/attachments" });
      expect(listRes.json().map((a: { id: string }) => a.id)).not.toContain(id);
    });

    it("actually removes the file from storage, not just the DB row (grill finding: FilesystemStorage.delete() was implemented and tested but never called)", async () => {
      const { headers, payload } = await buildMultipart(
        { actor: "mathew" },
        { field: "file", filename: "real-delete.txt", content: "delete my bytes too", type: "text/plain" },
      );
      const uploadRes = await app.inject({ method: "POST", url: "/api/items/item-1/attachments", headers, payload });
      const { id } = uploadRes.json();

      expect(readdirSync(tmpDir)).toContain(id);

      const deleteRes = await app.inject({ method: "DELETE", url: `/api/attachments/${id}` });
      expect(deleteRes.statusCode).toBe(204);

      expect(readdirSync(tmpDir)).not.toContain(id);
    });

    it("returns 404 when deleting an attachment id that never existed", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/attachments/does-not-exist" });
      expect(res.statusCode).toBe(404);
    });
  });
});
