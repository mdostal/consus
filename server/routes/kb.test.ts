import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerKbRoutes } from "./kb.js";

describe("POST /api/items/:id/decide", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-1", "doc_ref", "Test item", "open", now, now);

    app = Fastify();
    registerKbRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("decides an item and returns the audit trail", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/items/item-1/decide",
      payload: { actor: "mathew", newStatus: "approved" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.item.status).toBe("approved");
    expect(body.auditLog).toHaveLength(1);
  });

  it("404s for an unknown item", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/items/does-not-exist/decide",
      payload: { actor: "mathew", newStatus: "approved" },
    });

    expect(res.statusCode).toBe(404);
  });
});
