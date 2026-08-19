import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerDecisionRoutes } from "./decisions.js";

/**
 * s2-branch-scoped-decisions: GET /api/decisions?branch=<name> filtering.
 * Mirrors decisions.all.test.ts's structure (its ?all=1 sibling param).
 */

function insertItem(
  db: Database.Database,
  id: string,
  payload: string | null,
  sourceBranch: string | null = null,
) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload, source_branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", `Item ${id}`, "open", now, now, payload, sourceBranch);
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

describe("GET /api/decisions?branch=<name>", () => {
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

  it("AC4: returns only the items whose source_branch exactly matches, excluding other branches and NULL-branch items", async () => {
    insertItem(db, "item-x", PAYLOAD, "feat/x");
    insertItem(db, "item-y", PAYLOAD, "feat/y");
    insertItem(db, "item-main", PAYLOAD, null);

    const res = await app.inject({ method: "GET", url: "/api/decisions?branch=feat/x" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id)).toEqual(["item-x"]);
  });

  it("composes with ?all=1 — branch filter plus decided items included", async () => {
    insertItem(db, "item-x-open", PAYLOAD, "feat/x");
    insertItem(db, "item-x-decided", PAYLOAD, "feat/x");
    db.prepare("UPDATE items SET decided_at = ? WHERE id = ?").run(new Date().toISOString(), "item-x-decided");
    insertItem(db, "item-y-open", PAYLOAD, "feat/y");

    const res = await app.inject({ method: "GET", url: "/api/decisions?branch=feat/x&all=1" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id).sort()).toEqual(["item-x-decided", "item-x-open"]);
  });

  it("without ?all=1, a branch filter still excludes decided items from that branch", async () => {
    insertItem(db, "item-x-open-2", PAYLOAD, "feat/x");
    insertItem(db, "item-x-decided-2", PAYLOAD, "feat/x");
    db.prepare("UPDATE items SET decided_at = ? WHERE id = ?").run(new Date().toISOString(), "item-x-decided-2");

    const res = await app.inject({ method: "GET", url: "/api/decisions?branch=feat/x" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id)).toEqual(["item-x-open-2"]);
  });

  it("AC5: with no branch param, behavior is byte-identical to today — every item matching the pre-existing WHERE clause is returned regardless of source_branch", async () => {
    insertItem(db, "item-x-3", PAYLOAD, "feat/x");
    insertItem(db, "item-y-3", PAYLOAD, "feat/y");
    insertItem(db, "item-main-3", PAYLOAD, null);

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id).sort()).toEqual(["item-main-3", "item-x-3", "item-y-3"]);
  });

  it("a branch with no matching items returns an empty array, not an error", async () => {
    insertItem(db, "item-main-4", PAYLOAD, null);

    const res = await app.inject({ method: "GET", url: "/api/decisions?branch=no-such-branch" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
