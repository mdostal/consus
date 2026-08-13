import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerAuditTrailRoutes } from "./audit-trail.js";
import { decideItem } from "../kb/store.js";
import { proposeChange } from "../proposals/store.js";
import type { HarnessTransport } from "../harness/transport.js";

function insertItem(db: Database.Database, id: string) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", "Test item", "open", now, now);
}

function fakeTransport(): HarnessTransport {
  return {
    async invoke<T>() {
      return { ok: true, result: {} as T };
    },
  };
}

describe("GET /api/items/:id/audit-trail", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");

    app = Fastify();
    registerAuditTrailRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("returns an empty list (not an error) for an item with no history yet", async () => {
    const res = await app.inject({ method: "GET", url: "/api/items/item-1/audit-trail" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("includes audit_log entries with a distinguishing kind", async () => {
    decideItem(db, { itemId: "item-1", actor: "mathew", newStatus: "approved" });

    const res = await app.inject({ method: "GET", url: "/api/items/item-1/audit-trail" });
    const body = res.json();

    expect(body).toHaveLength(1);
    expect(body[0].kind).toBe("audit");
    expect(body[0].actor).toBe("mathew");
    expect(body[0].new_value).toBe("approved");
  });

  it("includes proposals (any status) with a distinguishing kind", async () => {
    await proposeChange(db, fakeTransport(), {
      itemId: "item-1",
      targetType: "doc",
      diff: "d",
      description: "desc",
      requestedBy: "mathew",
    });

    const res = await app.inject({ method: "GET", url: "/api/items/item-1/audit-trail" });
    const body = res.json();

    expect(body).toHaveLength(1);
    expect(body[0].kind).toBe("proposal");
    expect(body[0].status).toBeDefined();
  });

  it("renders identically for a decision, diagram, or doc item — same route, no type branching", async () => {
    insertItem(db, "diagram:consus");
    await proposeChange(db, fakeTransport(), {
      itemId: "diagram:consus",
      targetType: "diagram",
      diff: "d",
      description: "desc",
      requestedBy: "mathew",
    });

    const res = await app.inject({ method: "GET", url: "/api/items/diagram:consus/audit-trail" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("combines audit and proposal entries, most recent first", async () => {
    decideItem(db, { itemId: "item-1", actor: "mathew", newStatus: "approved" });
    await proposeChange(db, fakeTransport(), {
      itemId: "item-1",
      targetType: "doc",
      diff: "d",
      description: "desc",
      requestedBy: "mathew",
    });

    const res = await app.inject({ method: "GET", url: "/api/items/item-1/audit-trail" });
    const body = res.json();

    expect(body).toHaveLength(2);
    expect(body.map((e: { kind: string }) => e.kind).sort()).toEqual(["audit", "proposal"]);
  });
});
