import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerProposalRoutes } from "./proposals.js";
import type { MinervaTransport, MinervaResult } from "../adapters/minerva/transport.js";

function insertItem(db: Database.Database, id: string) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", "Test item", "open", now, now);
}

function fakeTransport(): MinervaTransport {
  return {
    async invoke<T>() {
      return { ok: true, result: {} } as MinervaResult<T>;
    },
  };
}

describe("POST /api/proposals", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");
    app = Fastify();
    registerProposalRoutes(app, { db, transport: fakeTransport() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("fires a proposal and returns it as pending", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/proposals",
      payload: {
        itemId: "item-1",
        targetType: "diagram",
        diff: "+ added X",
        description: "add X",
        requestedBy: "mathew",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("pending");
    expect(body.item_id).toBe("item-1");
  });

  it("404s for an unknown target item", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/proposals",
      payload: { itemId: "nope", targetType: "doc", diff: "d", description: "desc", requestedBy: "mathew" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("400s when required fields are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/proposals",
      payload: { itemId: "item-1" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/proposals/:id/result", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let proposalId: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");
    app = Fastify();
    registerProposalRoutes(app, { db, transport: fakeTransport() });
    await app.ready();

    const created = await app.inject({
      method: "POST",
      url: "/api/proposals",
      payload: { itemId: "item-1", targetType: "doc", diff: "d", description: "desc", requestedBy: "mathew" },
    });
    proposalId = created.json().id;
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("applies the harness's reported result", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposalId}/result`,
      payload: { status: "applied", appliedDiff: "d (confirmed)" },
    });

    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/proposals?itemId=item-1" });
    const body = list.json();
    expect(body[0].status).toBe("applied");
  });

  it("404s for an unknown proposal id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/proposals/does-not-exist/result",
      payload: { status: "applied" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/proposals", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");
    app = Fastify();
    registerProposalRoutes(app, { db, transport: fakeTransport() });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/proposals",
      payload: { itemId: "item-1", targetType: "doc", diff: "d", description: "desc", requestedBy: "mathew" },
    });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("lists proposals for the given item", async () => {
    const res = await app.inject({ method: "GET", url: "/api/proposals?itemId=item-1" });
    expect(res.json()).toHaveLength(1);
  });

  it("400s without ?itemId=", async () => {
    const res = await app.inject({ method: "GET", url: "/api/proposals" });
    expect(res.statusCode).toBe(400);
  });
});
