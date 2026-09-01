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

  it("classifies the new item so decision_type/triage_bucket come back populated, not null", async () => {
    const res = await post({ id: "classify-1", title: "Should we do X?", decision_payload: VALID_PAYLOAD });
    const body = res.json();

    // VALID_PAYLOAD has no `diagram` flag -> classifyItem's decisionType is
    // "choose", and a non-default decisionType with no extractionTier ->
    // triageBucket "open_question". Matches classifier.test.ts's own
    // "classifies any other valid decision_payload as 'choose'" case.
    expect(body.decision_type).toBe("choose");
    expect(body.triage_bucket).toBe("open_question");
  });

  it("classifies a diagram:true payload as decision-type 'cba', matching classifyItem", async () => {
    const res = await post({
      id: "classify-cba",
      title: "Approve the architecture?",
      decision_payload: { ...VALID_PAYLOAD, diagram: true },
    });
    const body = res.json();

    expect(body.decision_type).toBe("cba");
    expect(body.triage_bucket).toBe("open_question");
  });

  describe("feature-selection/v1 payloads", () => {
    const FEATURE_PAYLOAD = {
      version: "dostal:feature-selection/v1" as const,
      title: "Pick features",
      context: "Choose which features to enable.",
      features: [
        { id: "dark-mode", name: "Dark Mode", description: "Switch to dark theme." },
        { id: "oauth", name: "OAuth Login", description: "Sign in with Google/GitHub.", default: true },
      ],
    };

    it("accepts and stores a feature-selection/v1 payload", async () => {
      const res = await post({ id: "fs-1", title: "Feature selection", decision_payload: FEATURE_PAYLOAD });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.decision_payload).toEqual(FEATURE_PAYLOAD);
    });

    it("rejects a feature-selection/v1 payload with an empty features array", async () => {
      const res = await post({
        id: "fs-empty",
        title: "t",
        decision_payload: { ...FEATURE_PAYLOAD, features: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/features/i);
    });

    it("rejects a feature-selection/v1 payload with missing features field", async () => {
      const { features: _, ...withoutFeatures } = FEATURE_PAYLOAD;
      void _;
      const res = await post({ id: "fs-nofeatures", title: "t", decision_payload: withoutFeatures });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/features/i);
    });

    it("feature-selection/v1 items show up in GET /api/decisions", async () => {
      await post({ id: "fs-2", title: "Feature select", decision_payload: FEATURE_PAYLOAD });
      const get = await app.inject({ method: "GET", url: "/api/decisions" });
      const body = get.json();
      const found = body.find((i: { id: string }) => i.id === "fs-2");
      expect(found).toBeDefined();
      expect(found.decision_payload.version).toBe("dostal:feature-selection/v1");
    });
  });

  it("round-trips research[] losslessly: POST with research[] then GET returns research[] intact", async () => {
    const payloadWithResearch = {
      ...VALID_PAYLOAD,
      research: [
        { title: "Architecture survey", body: "We evaluated three approaches.", sources: ["https://example.com/ref"] },
        { title: "Prior art", body: "Similar systems omit caching at this layer." },
      ],
    };
    const postRes = await post({ id: "research-roundtrip", title: "Research round-trip", decision_payload: payloadWithResearch });
    expect(postRes.statusCode).toBe(201);

    const getRes = await app.inject({ method: "GET", url: "/api/decisions" });
    const items = getRes.json();
    const item = items.find((i: { id: string }) => i.id === "research-roundtrip");
    expect(item?.decision_payload?.research).toEqual(payloadWithResearch.research);
  });
});

describe("POST /api/decisions — feature-selection/v1", () => {
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

  const VALID_FEATURE_PAYLOAD = {
    version: "dostal:feature-selection/v1" as const,
    title: "Release feature set",
    context: "Pick which features land in v2.",
    features: [
      { id: "auth", name: "Auth", description: "Login/logout flow", default: true },
      { id: "dark-mode", name: "Dark mode", description: "System-level theme toggle" },
    ],
  };

  function post(body: unknown) {
    return app.inject({ method: "POST", url: "/api/decisions", payload: body });
  }

  it("accepts a valid feature-selection/v1 payload and returns 201", async () => {
    const res = await post({ id: "fs-1", title: "Feature set", decision_payload: VALID_FEATURE_PAYLOAD });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe("fs-1");
    expect(body.decision_payload).toMatchObject({ version: "dostal:feature-selection/v1" });
  });

  it("rejects a feature-selection/v1 payload with an empty features array", async () => {
    const res = await post({
      id: "fs-bad",
      title: "t",
      decision_payload: { ...VALID_FEATURE_PAYLOAD, features: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/feature/i);
  });

  it("all existing decision-request/v1 behavior unchanged", async () => {
    const v1Payload = JSON.parse(PAYLOAD);
    const res = await post({ id: "v1-still-works", title: "A/B decision", decision_payload: v1Payload });
    expect(res.statusCode).toBe(201);
  });
});

describe("GET /api/decisions classification backfill", () => {
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

  it("backfills decision_type/triage_bucket for a pre-existing row with decision_type left null, and persists the write so it isn't reclassified on a later GET", async () => {
    insertItem(db, "legacy-1", PAYLOAD); // decision_type/triage_bucket are null by default

    const first = await app.inject({ method: "GET", url: "/api/decisions" });
    const firstBody = first.json();
    expect(firstBody[0].decision_type).toBe("choose");
    expect(firstBody[0].triage_bucket).toBe("open_question");

    // Confirm the backfill actually persisted to the items row (not just
    // computed in-memory for this one response).
    const stored = db.prepare("SELECT decision_type, triage_bucket FROM items WHERE id = ?").get("legacy-1") as {
      decision_type: string | null;
      triage_bucket: string | null;
    };
    expect(stored.decision_type).toBe("choose");
    expect(stored.triage_bucket).toBe("open_question");

    // Now mutate the stored values to sentinels that classifyItem would
    // never produce for this payload. If a second GET re-invoked
    // classifyItem for this row (already non-null decision_type), it would
    // overwrite these sentinels back to "choose"/"open_question". It must
    // not.
    db.prepare("UPDATE items SET decision_type = 'edit', triage_bucket = 'noise' WHERE id = ?").run("legacy-1");

    const second = await app.inject({ method: "GET", url: "/api/decisions" });
    const secondBody = second.json();
    expect(secondBody[0].decision_type).toBe("edit");
    expect(secondBody[0].triage_bucket).toBe("noise");
  });
});
