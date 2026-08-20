import type { FastifyInstance } from "fastify";
import fastifyMultipart, { type MultipartFile } from "@fastify/multipart";
import type Database from "better-sqlite3";
import path from "node:path";
import type { StorageAdapter } from "../storage/adapter.js";

export interface AttachmentRoutesOptions {
  db: Database.Database;
  storageAdapter: StorageAdapter;
}

interface AttachmentRow {
  id: string;
  item_id: string;
  file_name: string;
  mime_type: string;
  size: number;
  actor: string;
  created_at: string;
  deleted_at: string | null;
}

// Extension-based allowlist only, not real content-sniffing on the file's
// *bytes* (a malicious file renamed with an allowed extension isn't
// caught). Matches the old branch's own acknowledged v1 scope
// (design-discussion.md §5) — a known, accepted limitation, not a claim of
// full validation.
//
// SECURITY (grill finding, post-consus-phase23): the served Content-Type
// must NEVER be the client-supplied multipart mimetype — a client can set
// that field to anything (e.g. "text/html") regardless of the actual file
// extension/bytes, and GET /api/attachments/:id previously replayed it
// verbatim with Content-Disposition: inline, letting a same-origin-hosted
// upload execute as a stored-XSS payload when the raw URL is visited
// directly. The Content-Type stored and served is now always derived
// server-side from the (already-allowlisted) extension, never trusted from
// the request. ALLOWED_EXTENSIONS is derived from this map's keys so the
// two can never drift apart.
const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/plain",
  ".json": "application/json",
  ".zip": "application/zip",
};
const ALLOWED_EXTENSIONS = Object.keys(EXTENSION_MIME_TYPES);

// Only types with no plausible browser-side active-content interpretation
// are ever served inline; everything else is forced to download
// (Content-Disposition: attachment), even though its Content-Type is
// already a safe, server-derived value — defense in depth.
const INLINE_SAFE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "application/pdf"]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getFieldValue(fields: MultipartFile["fields"], name: string): string | undefined {
  const field = fields[name];
  if (!field) return undefined;
  const single = Array.isArray(field) ? field[0] : field;
  return single && single.type === "field" ? (single.value as string) : undefined;
}

/**
 * Ported from origin/feat/PAN-7819's server/routes/attachments.ts (see
 * consus-phase23-decision-attachments/docs/design-discussion.md §2-3) with
 * the changes that section requires:
 *  - routes live under /api/items/:id/attachments (not /api/tickets/:id/...)
 *  - `actor` is a required multipart form field, never the old branch's
 *    hardcoded "authenticated_user" placeholder
 *  - GET /api/items/:id/attachments (list) is new — the old branch had no
 *    way to list an item's attachments at all
 */
export function registerAttachmentRoutes(app: FastifyInstance, { db, storageAdapter }: AttachmentRoutesOptions): void {
  void app.register(fastifyMultipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/attachments", async (request, reply) => {
    const itemId = request.params.id;

    const itemRow = db.prepare("SELECT id FROM items WHERE id = ?").get(itemId) as { id: string } | undefined;
    if (!itemRow) {
      return reply.code(404).send({ error: "item not found" });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    const ext = path.extname(data.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return reply.code(400).send({ error: "File type not allowed" });
    }

    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE" || code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT") {
        return reply.code(413).send({ error: "Payload Too Large" });
      }
      throw err;
    }

    // Read fields *after* draining the file stream — @fastify/multipart only
    // guarantees `data.fields` reflects parts that arrived before the file
    // part in the multipart stream until the file is fully consumed.
    const actor = getFieldValue(data.fields, "actor");
    if (!actor) {
      return reply.code(400).send({ error: "actor is required" });
    }

    // Server-derived from the (already-allowlisted) extension — never the
    // client-supplied data.mimetype. See the EXTENSION_MIME_TYPES comment
    // above for why.
    const mimeType = EXTENSION_MIME_TYPES[ext];
    const file = new File([buffer], data.filename, { type: mimeType });

    const storageId = await storageAdapter.upload(file, {
      name: data.filename,
      type: mimeType,
      size: buffer.length,
    });

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO attachments (id, item_id, file_name, mime_type, size, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(storageId, itemId, data.filename, mimeType, buffer.length, actor, now);

    return reply.code(201).send({
      id: storageId,
      item_id: itemId,
      file_name: data.filename,
      mime_type: mimeType,
      size: buffer.length,
      created_at: now,
    });
  });

  app.get<{ Params: { id: string } }>("/api/items/:id/attachments", async (request) => {
    const itemId = request.params.id;
    return db
      .prepare(
        `SELECT id, item_id, file_name, mime_type, size, actor, created_at
         FROM attachments
         WHERE item_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC`,
      )
      .all(itemId);
  });

  app.get<{ Params: { id: string } }>("/api/attachments/:id", async (request, reply) => {
    const attachmentId = request.params.id;

    const attachment = db
      .prepare("SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL")
      .get(attachmentId) as AttachmentRow | undefined;

    if (!attachment) {
      return reply.code(404).send({ error: "Attachment not found" });
    }

    try {
      const blob = await storageAdapter.download(attachmentId);

      const disposition = INLINE_SAFE_TYPES.has(attachment.mime_type) ? "inline" : "attachment";
      reply.header("Content-Type", attachment.mime_type);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Disposition", `${disposition}; filename="${encodeURIComponent(attachment.file_name)}"`);

      return reply.send(blob.stream());
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        return reply.code(404).send({ error: "File not found in storage" });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/api/attachments/:id", async (request, reply) => {
    const attachmentId = request.params.id;

    const attachment = db.prepare("SELECT id FROM attachments WHERE id = ?").get(attachmentId);
    if (!attachment) {
      return reply.code(404).send({ error: "Attachment not found" });
    }

    // Grill finding (post-consus-phase23): the underlying file was never
    // actually removed from storage — only deleted_at was set, leaving
    // every "deleted" attachment's bytes on disk indefinitely even though
    // FilesystemStorage.delete() was already fully implemented and tested
    // in isolation. Now genuinely freed: the DB row stays as a tombstone
    // (deleted_at set, excluded from list/download) but the file itself is
    // removed. FilesystemStorage.delete() is itself idempotent (a no-op on
    // an already-missing file), matching this route's own idempotent intent.
    await storageAdapter.delete(attachmentId);

    const now = new Date().toISOString();
    db.prepare("UPDATE attachments SET deleted_at = ? WHERE id = ?").run(now, attachmentId);

    return reply.code(204).send();
  });
}
