import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerDecisionRoutes } from "./decisions.js";
import { registerKbRoutes } from "./kb.js";
import { decideItem } from "../kb/store.js";

function insertItem(db: Database.Database, id: string, payload: string | null, decided = false) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", `Item ${id}`, "open", now, now, payload);
  if (decided) {
    decideItem(db, { itemId: id, actor: "mathew", newStatus: "approved" });
  }
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
    registerDecisionRoutes(app, { db });
    registerKbRoutes(app, { db });
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

  it("?all=1 includes decided items alongside open ones", async () => {
    insertItem(db, "item-7", PAYLOAD);
    insertItem(db, "item-8", PAYLOAD, true);

    const res = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id).sort()).toEqual(["item-7", "item-8"]);
  });

  it("AC2 e2e: an item moves from the open queue to ?all=1-only after a real POST verdict", async () => {
    insertItem(db, "item-9", PAYLOAD);

    const before = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(before.json().map((i: { id: string }) => i.id)).toEqual(["item-9"]);

    const verdict = await app.inject({
      method: "POST",
      url: "/api/items/item-9/decide",
      payload: { actor: "mathew", newStatus: "approved" },
    });
    expect(verdict.statusCode).toBe(200);

    const openAfter = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(openAfter.json()).toEqual([]);

    const allAfter = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    expect(allAfter.json().map((i: { id: string }) => i.id)).toEqual(["item-9"]);
  });
});
