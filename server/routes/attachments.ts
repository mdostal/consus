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

// Extension-based allowlist only, not real content-sniffing (no MIME
// confusion protection — a malicious file renamed with an allowed extension
// isn't caught). Matches the old branch's own acknowledged v1 scope
// (design-discussion.md §5) — a known, accepted limitation, not a claim of
// full validation.
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".txt", ".md", ".csv", ".json", ".zip"];
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

    const mimeType = data.mimetype;
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

      reply.header("Content-Type", attachment.mime_type);
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.file_name)}"`);

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

    const now = new Date().toISOString();
    db.prepare("UPDATE attachments SET deleted_at = ? WHERE id = ?").run(now, attachmentId);

    return reply.code(204).send();
  });
}
