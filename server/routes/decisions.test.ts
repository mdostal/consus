import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerDecisionRoutes } from "./decisions.js";
import { decideItem } from "../kb/store.js";
import type { MulticaClient, MulticaListResult } from "../adapters/multica/client.js";

function insertItem(db: Database.Database, id: string, payload: string | null, decided = false) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", `Item ${id}`, "open", now, now, payload);
  if (decided) {
    decideItem(db, { itemId: id, actor: "mathew", newStatus: "approved" });
  }
}

function fakeClient(listResult: MulticaListResult = { ok: true, issues: [] }): MulticaClient {
  return {
    writeComment: async () => ({ ok: false, error: "unused in these tests" }),
    listIssues: async () => listResult,
  };
}

const PAYLOAD = JSON.stringify({
  version: "dostal:decision-request/v1",
  title: "q",
  context: "",
  options: [
    { id: "A", title: "Yes", tradeoffs: "" },
    { id: "B", title: "No", tradeoffs: "" },
  ],
  recommended: "A",
});

describe("GET /api/decisions", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerDecisionRoutes(app, { db, client: fakeClient() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("lists every open item carrying a decision_payload", async () => {
    insertItem(db, "item-1", PAYLOAD);
    insertItem(db, "item-2", PAYLOAD);
    insertItem(db, "item-3", null); // no decision_payload — not a decision

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id).sort()).toEqual(["item-1", "item-2"]);
  });

  it("excludes decided items — the decided-store amnesia fix applies to the API too", async () => {
    insertItem(db, "item-4", PAYLOAD);
    insertItem(db, "item-5", PAYLOAD, true);

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id)).toEqual(["item-4"]);
  });

  it("parses decision_payload into the response rather than leaving it as a raw JSON string", async () => {
    insertItem(db, "item-6", PAYLOAD);

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body[0].decision_payload).toEqual(JSON.parse(PAYLOAD));
  });
});

describe("GET /api/decisions — live Multica sync", () => {
  let db: Database.Database;

  afterEach(async () => {
    db.close();
  });

  it("syncs live Multica issues into the queue on every request", async () => {
    db = new Database(":memory:");
    runMigration(db);
    const app = Fastify();
    registerDecisionRoutes(app, {
      db,
      client: fakeClient({
        ok: true,
        issues: [
          {
            id: "i-1",
            identifier: "DOS-1",
            title: "Ship v1?",
            description: "body",
            status: "todo",
            priority: null,
            labels: [],
            updatedAt: null,
            createdAt: null,
            parentId: null,
          },
        ],
      }),
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id)).toContain("multica:i-1");
    await app.close();
  });

  it("includes ingested Multica items even without a decision_payload — classification alone is enough to surface them", async () => {
    db = new Database(":memory:");
    runMigration(db);
    const app = Fastify();
    registerDecisionRoutes(app, {
      db,
      client: fakeClient({
        ok: true,
        issues: [
          {
            id: "i-2",
            identifier: "DOS-2",
            title: "some raw ticket with no decision-request block",
            description: "just prose",
            status: "todo",
            priority: null,
            labels: [],
            updatedAt: null,
            createdAt: null,
            parentId: null,
          },
        ],
      }),
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();
    const item = body.find((i: { id: string }) => i.id === "multica:i-2");

    expect(item).toBeDefined();
    expect(item.decision_payload).toBeNull();
    expect(item.decision_type).toBeDefined();
    await app.close();
  });

  it("returns 503 when the Multica sync fails, rather than crashing or silently returning nothing", async () => {
    db = new Database(":memory:");
    runMigration(db);
    const app = Fastify();
    registerDecisionRoutes(app, { db, client: fakeClient({ ok: false, error: "ECONNREFUSED" }) });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/decisions" });

    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
