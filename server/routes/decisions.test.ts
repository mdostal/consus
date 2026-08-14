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

describe("GET /api/decisions", () => {
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

describe("POST /api/decisions", () => {
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

  const VALID_PAYLOAD = JSON.parse(PAYLOAD);

  function post(body: unknown) {
    return app.inject({ method: "POST", url: "/api/decisions", payload: body });
  }

  it("creates a new item that shows up in a subsequent GET with the same decision_payload", async () => {
    const res = await post({ id: "pushed-1", title: "Should we do X?", decision_payload: VALID_PAYLOAD });
    expect(res.statusCode).toBe(201);

    const get = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = get.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("pushed-1");
    expect(body[0].decision_payload).toEqual(VALID_PAYLOAD);
  });

  it("rejects a request missing id with 400 naming the missing field", async () => {
    const res = await post({ title: "no id", decision_payload: VALID_PAYLOAD });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/id/i);
  });

  it("rejects a request missing title with 400 naming the missing field", async () => {
    const res = await post({ id: "no-title", decision_payload: VALID_PAYLOAD });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/title/i);
  });

  it("rejects a decision_payload with the wrong version string", async () => {
    const res = await post({
      id: "bad-version",
      title: "t",
      decision_payload: { ...VALID_PAYLOAD, version: "not-the-right-version" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/version/i);
  });

  it("rejects a decision_payload with fewer than 2 options", async () => {
    const res = await post({
      id: "one-option",
      title: "t",
      decision_payload: { ...VALID_PAYLOAD, options: [{ id: "A", title: "Only", tradeoffs: "" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/option/i);
  });

  it("rejects a decision_payload whose recommended letter doesn't match any option id", async () => {
    const res = await post({
      id: "bad-recommended",
      title: "t",
      decision_payload: { ...VALID_PAYLOAD, recommended: "Z" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/recommended/i);
  });

  it("returns 409 and modifies nothing when id already exists", async () => {
    await post({ id: "dup-1", title: "first", decision_payload: VALID_PAYLOAD });
    const res = await post({ id: "dup-1", title: "second, should be rejected", decision_payload: VALID_PAYLOAD });
    expect(res.statusCode).toBe(409);

    const get = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = get.json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe("first");
  });

  it("returns the created item in the same shape GET /api/decisions returns", async () => {
    const res = await post({
      id: "shape-check",
      title: "Shape check",
      source_repo: "consus",
      decision_payload: VALID_PAYLOAD,
    });
    const body = res.json();
    expect(body).toMatchObject({
      id: "shape-check",
      type: expect.any(String),
      title: "Shape check",
      status: expect.any(String),
      source_repo: "consus",
      decision_payload: VALID_PAYLOAD,
    });
  });
});
