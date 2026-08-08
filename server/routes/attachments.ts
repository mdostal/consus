import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import type Database from "better-sqlite3";
import type { StorageAdapter } from "../storage/adapter.js";
import path from "node:path";

export interface AttachmentRoutesOptions {
  db: Database.Database;
  storageAdapter: StorageAdapter;
}

const ALLOWED_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".pdf", 
  ".txt", ".md", ".csv", ".json", ".zip"
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function registerAttachmentRoutes(
  app: FastifyInstance,
  { db, storageAdapter }: AttachmentRoutesOptions
): void {
  // Register multipart plugin
  app.register(fastifyMultipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

  // POST /api/tickets/:id/attachments
  app.post(
    "/api/tickets/:id/attachments",
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const ticketId = req.params.id;

      // Ensure ticket exists
      const ticketRow = db
        .prepare("SELECT id FROM items WHERE id = ?")
        .get(ticketId) as { id: string } | undefined;
      
      if (!ticketRow) {
        return reply.status(404).send({ error: "Ticket not found" });
      }

      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      // Check file extension
      const ext = path.extname(data.filename).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return reply.status(400).send({ error: "File type not allowed" });
      }

      // Read file buffer (subject to fastifyMultipart limits)
      let buffer: Buffer;
      try {
        buffer = await data.toBuffer();
      } catch (err: any) {
        if (err.code === "FST_REQ_FILE_TOO_LARGE") {
          return reply.status(413).send({ error: "Payload Too Large" });
        }
        throw err;
      }

      // For MIME sniffing placeholder / naive validation
      const mimeType = data.mimetype;

      // StorageAdapter requires a Web File object (available in Node.js globals)
      const file = new File([buffer], data.filename, { type: mimeType });

      // Upload to storage
      const storageId = await storageAdapter.upload(file, {
        name: data.filename,
        type: mimeType,
        size: buffer.length,
      });

      // Insert metadata into DB
      const now = new Date().toISOString();
      const uploadedBy = "authenticated_user"; // placeholder for auth

      db.prepare(
        `INSERT INTO attachments (id, item_id, file_name, mime_type, size, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(storageId, ticketId, data.filename, mimeType, buffer.length, uploadedBy, now);

      return reply.status(201).send({
        id: storageId,
        item_id: ticketId,
        file_name: data.filename,
        mime_type: mimeType,
        size: buffer.length,
        created_at: now,
      });
    }
  );

  // GET /api/attachments/:id
  app.get(
    "/api/attachments/:id",
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const attachmentId = req.params.id;

      const attachment = db
        .prepare("SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL")
        .get(attachmentId) as { mime_type: string; file_name: string } | undefined;

      if (!attachment) {
        return reply.status(404).send({ error: "Attachment not found" });
      }

      try {
        const blob = await storageAdapter.download(attachmentId);
        
        reply.header("Content-Type", attachment.mime_type);
        reply.header(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(attachment.file_name)}"`
        );
        
        // Fastify 5 supports sending ReadableStream directly.
        // Blob.stream() returns a ReadableStream.
        return reply.send(blob.stream());
      } catch (err: any) {
        if (err.message && err.message.includes("not found")) {
          return reply.status(404).send({ error: "File not found in storage" });
        }
        throw err;
      }
    }
  );

  // DELETE /api/attachments/:id
  app.delete(
    "/api/attachments/:id",
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const attachmentId = req.params.id;

      const attachment = db
        .prepare("SELECT id FROM attachments WHERE id = ?")
        .get(attachmentId);

      if (!attachment) {
        return reply.status(404).send({ error: "Attachment not found" });
      }

      // Soft or hard delete? AC says "file is removed and 204 returned".
      // Design decision says "Soft-delete attachments (mark deleted, cleanup job removes)"
      const now = new Date().toISOString();
      db.prepare("UPDATE attachments SET deleted_at = ? WHERE id = ?").run(now, attachmentId);

      return reply.status(204).send();
    }
  );
}
