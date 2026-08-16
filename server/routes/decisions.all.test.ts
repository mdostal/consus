import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerDecisionRoutes } from "./decisions.js";
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

describe("GET /api/decisions?all=1", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerDecisionRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("includes decided items so the shell can present a reviewable 'Decided' section", async () => {
    insertItem(db, "open-1", PAYLOAD);
    insertItem(db, "decided-1", PAYLOAD, true);

    const res = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id).sort()).toEqual(["decided-1", "open-1"]);
  });

  it("surfaces open items before decided ones", async () => {
    insertItem(db, "decided-2", PAYLOAD, true);
    insertItem(db, "open-2", PAYLOAD);

    const res = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    const body = res.json();

    expect(body[0].id).toBe("open-2");
    expect(body[0].decided_at).toBeNull();
    expect(body[1].decided_at).not.toBeNull();
  });

  it("still excludes decided items when ?all is absent", async () => {
    insertItem(db, "open-3", PAYLOAD);
    insertItem(db, "decided-3", PAYLOAD, true);

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id)).toEqual(["open-3"]);
  });

  it("backfills decision_type/triage_bucket for both open and decided items under ?all=1", async () => {
    insertItem(db, "open-4", PAYLOAD);
    insertItem(db, "decided-4", PAYLOAD, true);

    const res = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    const body = res.json();

    for (const item of body) {
      expect(item.decision_type).toBe("choose");
      expect(item.triage_bucket).toBe("open_question");
    }
  });
});
