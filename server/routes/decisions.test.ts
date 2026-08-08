import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerDecisionRoutes } from "./decisions.js";
import { registerKbRoutes } from "./kb.js";
import { decideItem } from "../kb/store.js";
import type { MulticaClient, MulticaIssue, MulticaListResult } from "../adapters/multica/client.js";

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

function makeIssue(overrides: Partial<MulticaIssue> = {}): MulticaIssue {
  return {
    id: "issue-1",
    identifier: "MUL-1",
    title: "Some issue",
    description: null,
    status: "in_review",
    priority: "none",
    labels: [],
    updatedAt: null,
    createdAt: null,
    ...overrides,
  };
}

/** Fake MulticaClient — resolves with whatever `result` currently holds, so a
 *  test can swap the response (e.g. simulate a fetch failure) after setup. */
function fakeClient(result: MulticaListResult): MulticaClient {
  return {
    async writeComment() {
      return { ok: true, multicaCommentId: "unused" };
    },
    async listIssues() {
      return result;
    },
  };
}

const EMPTY_CLIENT = fakeClient({ ok: true, issues: [] });

describe("GET /api/decisions", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerDecisionRoutes(app, { db, client: EMPTY_CLIENT });
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

describe("GET /api/decisions — live Multica sync", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  async function buildApp(client: MulticaClient) {
    app = Fastify();
    registerDecisionRoutes(app, { db, client });
    await app.ready();
    return app;
  }

  it("fetches and classifies the live Multica feed, returning only open (undecided) issues", async () => {
    const client = fakeClient({
      ok: true,
      issues: [makeIssue({ id: "mul-open", title: "Choose the layout" })],
    });
    await buildApp(client);

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "multica:mul-open",
      type: "multica_issue",
      decision_type: "choose",
    });
  });

  it("excludes an already-decided Multica issue from the default (open-only) queue", async () => {
    // First sync ingests + decides the issue locally.
    await buildApp(fakeClient({ ok: true, issues: [makeIssue({ id: "mul-decided", title: "Pick one option" })] }));
    await app.inject({ method: "GET", url: "/api/decisions" });
    decideItem(db, { itemId: "multica:mul-decided", actor: "mathew", newStatus: "done" });

    const openRes = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(openRes.json().map((i: { id: string }) => i.id)).not.toContain("multica:mul-decided");
  });

  it("?all=1 includes decided Multica issues alongside open ones", async () => {
    await buildApp(fakeClient({ ok: true, issues: [makeIssue({ id: "mul-all", title: "Survey the team" })] }));
    await app.inject({ method: "GET", url: "/api/decisions" });
    decideItem(db, { itemId: "multica:mul-all", actor: "mathew", newStatus: "done" });

    const res = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    expect(res.json().map((i: { id: string }) => i.id)).toContain("multica:mul-all");
  });

  it("count parity: ~79 open Multica issues yields ~79 returned decisions", async () => {
    const issues = Array.from({ length: 79 }, (_, i) => makeIssue({ id: `mul-bulk-${i}`, title: `Task ${i}` }));
    await buildApp(fakeClient({ ok: true, issues }));

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(res.json()).toHaveLength(79);
  });

  it("returns 503 with a descriptive error when the Multica fetch fails", async () => {
    await buildApp(fakeClient({ ok: false, error: "Multica returned HTTP 500" }));

    const res = await app.inject({ method: "GET", url: "/api/decisions" });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("500");
  });
});
