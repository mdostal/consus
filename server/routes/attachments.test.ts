/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigration } from "../db/migrate.js";
import { registerAttachmentRoutes } from "./attachments.js";
import { FilesystemStorage } from "../storage/filesystem.js";
import FormData from "form-data";
import fs from "node:fs";
import { Buffer } from "node:buffer";

function insertTicket(db: Database.Database, id: string) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "ticket", `Ticket ${id}`, "open", now, now);
}

describe("Attachment Routes", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let tmpDir: string;
  let storageAdapter: FilesystemStorage;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    insertTicket(db, "ticket-1");

    tmpDir = mkdtempSync(join(tmpdir(), "consus-attachments-test-"));
    storageAdapter = new FilesystemStorage(tmpDir);

    app = Fastify({ logger: false });
    registerAttachmentRoutes(app, { db, storageAdapter });
    await app.ready();
  });

  afterEach(async () => {
    db.close();
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uploads a file successfully and returns metadata", async () => {
    const form = new FormData();
    form.append("file", Buffer.from("hello world"), {
      filename: "test.txt",
      contentType: "text/plain",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/tickets/ticket-1/attachments",
      headers: form.getHeaders(),
      payload: form,
    });

    if (response.statusCode === 500) {
      console.error(response.payload);
    }
    
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.id).toBeDefined();
    expect(body.file_name).toBe("test.txt");
    expect(body.mime_type).toBe("text/plain");
    expect(body.size).toBe(11);

    // Verify it's in the db
    const row = db.prepare("SELECT * FROM attachments WHERE id = ?").get(body.id) as any;
    expect(row).toBeDefined();
    expect(row.file_name).toBe("test.txt");
  });

  it("rejects disallowed file extensions", async () => {
    const form = new FormData();
    form.append("file", Buffer.from("malicious payload"), {
      filename: "test.exe",
      contentType: "application/x-msdownload",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/tickets/ticket-1/attachments",
      headers: form.getHeaders(),
      payload: form,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toBe("File type not allowed");
  });

  it("downloads an existing attachment", async () => {
    // 1. Upload
    const form = new FormData();
    form.append("file", Buffer.from("download test content"), {
      filename: "download.txt",
      contentType: "text/plain",
    });

    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/tickets/ticket-1/attachments",
      headers: form.getHeaders(),
      payload: form,
    });
    const { id } = JSON.parse(uploadRes.payload);

    // 2. Download
    const downloadRes = await app.inject({
      method: "GET",
      url: `/api/attachments/${id}`,
    });

    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers["content-type"]).toBe("text/plain");
    expect(downloadRes.headers["content-disposition"]).toBe('inline; filename="download.txt"');
    expect(downloadRes.payload).toBe("download test content");
  });

  it("soft-deletes an attachment", async () => {
    // 1. Upload
    const form = new FormData();
    form.append("file", Buffer.from("delete test"), {
      filename: "del.txt",
      contentType: "text/plain",
    });

    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/tickets/ticket-1/attachments",
      headers: form.getHeaders(),
      payload: form,
    });
    const { id } = JSON.parse(uploadRes.payload);

    // 2. Delete
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/attachments/${id}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    // 3. Verify it is no longer returned on GET
    const downloadRes = await app.inject({
      method: "GET",
      url: `/api/attachments/${id}`,
    });
    expect(downloadRes.statusCode).toBe(404);

    // Verify deleted_at is set
    const row = db.prepare("SELECT deleted_at FROM attachments WHERE id = ?").get(id) as any;
    expect(row.deleted_at).not.toBeNull();
  });

  it("rejects file larger than 10MB", async () => {
    const form = new FormData();
    // 10MB + 1 byte
    const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1, "a");
    form.append("file", largeBuffer, {
      filename: "large.txt",
      contentType: "text/plain",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/tickets/ticket-1/attachments",
      headers: form.getHeaders(),
      payload: form,
    });

    expect(response.statusCode).toBe(413);
  });
});
