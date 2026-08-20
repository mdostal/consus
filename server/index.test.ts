/**
 * @vitest-environment node
 *
 * The attachments-default-dir test below constructs a real File/FormData
 * upload; this repo's default jsdom test environment ships a stub File
 * lacking arrayBuffer() (see server/storage/filesystem.test.ts's docblock
 * for the full explanation). None of this file's other tests depend on
 * jsdom-specific globals, so forcing node for the whole file is safe.
 */
import { describe, it, expect, afterAll } from "vitest";
import { existsSync, unlinkSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { buildServer } from "./index.js";

describe("GET /health", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");

  afterAll(() => {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  it("returns 200 with a JSON body confirming SQLite connectivity", async () => {
    const app = buildServer({ dbPath });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.sqlite).toBe("connected");

    await app.close();
  });
});

describe("static web SPA serving (mdostal/consus#105)", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
  const webRoot = mkdtempSync(join(tmpdir(), "consus-dist-web-"));
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><html><body>consus</body></html>");
  mkdirSync(join(webRoot, "assets"));
  writeFileSync(join(webRoot, "assets", "app.js"), "console.log('app');");

  afterAll(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("serves index.html at GET / when a built web root exists", async () => {
    const app = buildServer({ dbPath, webRoot });

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("consus");

    await app.close();
  });

  it("serves a real built asset file directly", async () => {
    const app = buildServer({ dbPath, webRoot });

    const response = await app.inject({ method: "GET", url: "/assets/app.js" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("console.log");

    await app.close();
  });

  it("falls back to index.html for an unrecognized GET path (SPA fallback), not a bare 404", async () => {
    const app = buildServer({ dbPath, webRoot });

    const response = await app.inject({ method: "GET", url: "/some/deep/link" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("consus");

    await app.close();
  });

  it("still returns a real JSON 404 for an unmatched /api/* route, not the SPA fallback", async () => {
    const app = buildServer({ dbPath, webRoot });

    const response = await app.inject({ method: "GET", url: "/api/this-route-does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("Not Found");
    expect(response.body).not.toContain("<!doctype html>");

    await app.close();
  });

  it("does not register static serving at all when no web root exists (e.g. a fresh checkout before npm run build:web)", async () => {
    const app = buildServer({ dbPath, webRoot: join(webRoot, "definitely-does-not-exist") });

    const response = await app.inject({ method: "GET", url: "/" });

    // No static plugin registered and no SPA-fallback notFoundHandler installed —
    // Fastify's own default 404 behavior applies, same as before this story.
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});

describe("attachments storage default location (mirrors CONSUS_DB_PATH's default-plus-override convention)", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
  const defaultAttachmentsDir = join(process.cwd(), ".pHive", "attachments");
  const preExisted = existsSync(defaultAttachmentsDir);

  afterAll(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (!preExisted && existsSync(defaultAttachmentsDir)) {
      rmSync(defaultAttachmentsDir, { recursive: true, force: true });
    }
  });

  it("writes an uploaded attachment under .pHive/attachments/ (relative to cwd) when CONSUS_ATTACHMENTS_DIR / attachmentsDir is not supplied", async () => {
    const app = buildServer({ dbPath });
    const db = new Database(dbPath);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("default-dir-item", "decision_request", "Item", "open", now, now);
    db.close();

    const form = new FormData();
    form.append("actor", "mathew");
    form.append("file", new File([Buffer.from("default dir content")], "a.txt", { type: "text/plain" }));
    const formResponse = new Response(form);

    const response = await app.inject({
      method: "POST",
      url: "/api/items/default-dir-item/attachments",
      headers: { "content-type": formResponse.headers.get("content-type")! },
      payload: Buffer.from(await formResponse.arrayBuffer()),
    });

    expect(response.statusCode).toBe(201);
    expect(existsSync(defaultAttachmentsDir)).toBe(true);
    expect(readdirSync(defaultAttachmentsDir).length).toBeGreaterThan(0);

    await app.close();
  });
});
