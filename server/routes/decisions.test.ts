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

  describe("edit-proposal/v1 payloads", () => {
    const EDIT_PAYLOAD = {
      version: "dostal:edit-proposal/v1" as const,
      title: "Amend the weekly ops report",
      context: "Tighten the summary paragraph.",
      original: "line one\nline two\nline three",
      proposed: "line one\nline two, tightened\nline three",
    };

    it("accepts and stores an edit-proposal/v1 payload", async () => {
      const res = await post({ id: "edit-1", title: "Edit proposal", decision_payload: EDIT_PAYLOAD });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.decision_payload).toEqual(EDIT_PAYLOAD);
    });

    it("rejects an edit-proposal/v1 payload missing proposed", async () => {
      const { proposed: _proposed, ...withoutProposed } = EDIT_PAYLOAD;
      void _proposed;
      const res = await post({ id: "edit-missing-proposed", title: "t", decision_payload: withoutProposed });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/proposed/i);
    });

    it("rejects an edit-proposal/v1 payload where original is not a string", async () => {
      const res = await post({
        id: "edit-bad-original",
        title: "t",
        decision_payload: { ...EDIT_PAYLOAD, original: 42 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/original/i);
    });

    it("edit-proposal/v1 items show up in GET /api/decisions", async () => {
      await post({ id: "edit-2", title: "Edit proposal", decision_payload: EDIT_PAYLOAD });
      const get = await app.inject({ method: "GET", url: "/api/decisions" });
      const body = get.json();
      const found = body.find((i: { id: string }) => i.id === "edit-2");
      expect(found).toBeDefined();
      expect(found.decision_payload.version).toBe("dostal:edit-proposal/v1");
    });
  });

  describe("cba/v1 payloads", () => {
    const CBA_PAYLOAD = {
      version: "dostal:cba/v1" as const,
      title: "Buy vs build the reporting pipeline",
      context: "Compare the two paths before committing.",
      options: [
        { option: "Buy", cost: "$50k/yr", benefit: "Fast to ship", notes: "Vendor lock-in risk" },
        { option: "Build", cost: "2 eng-months", benefit: "Full control" },
      ],
    };

    it("accepts and stores a cba/v1 payload", async () => {
      const res = await post({ id: "cba-1", title: "CBA", decision_payload: CBA_PAYLOAD });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.decision_payload).toEqual(CBA_PAYLOAD);
    });

    it("rejects a cba/v1 payload with an empty options array", async () => {
      const res = await post({
        id: "cba-empty",
        title: "t",
        decision_payload: { ...CBA_PAYLOAD, options: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/options/i);
    });

    it("rejects a cba/v1 payload whose option entry is missing cost", async () => {
      const res = await post({
        id: "cba-bad-option",
        title: "t",
        decision_payload: { ...CBA_PAYLOAD, options: [{ option: "Buy", benefit: "Fast" }] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/option/i);
    });

    it("cba/v1 items show up in GET /api/decisions", async () => {
      await post({ id: "cba-2", title: "CBA", decision_payload: CBA_PAYLOAD });
      const get = await app.inject({ method: "GET", url: "/api/decisions" });
      const body = get.json();
      const found = body.find((i: { id: string }) => i.id === "cba-2");
      expect(found).toBeDefined();
      expect(found.decision_payload.version).toBe("dostal:cba/v1");
    });
  });

  describe("free-text/v1 payloads (s5-freetext-rating-ranking-answer-shapes)", () => {
    const FREE_TEXT_PAYLOAD = {
      version: "dostal:free-text/v1" as const,
      title: "Anything else?",
      context: "Wrapping up the retro.",
      prompt: "Share any additional feedback",
    };

    it("accepts and stores a free-text/v1 payload", async () => {
      const res = await post({ id: "ft-1", title: "Free text", decision_payload: FREE_TEXT_PAYLOAD });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.decision_payload).toEqual(FREE_TEXT_PAYLOAD);
    });

    it("rejects a free-text/v1 payload with an empty prompt", async () => {
      const res = await post({
        id: "ft-empty",
        title: "t",
        decision_payload: { ...FREE_TEXT_PAYLOAD, prompt: "" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/prompt/i);
    });

    it("rejects a free-text/v1 payload with a missing prompt", async () => {
      const { prompt: _prompt, ...withoutPrompt } = FREE_TEXT_PAYLOAD;
      void _prompt;
      const res = await post({ id: "ft-missing", title: "t", decision_payload: withoutPrompt });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/prompt/i);
    });

    it("free-text/v1 items show up in GET /api/decisions", async () => {
      await post({ id: "ft-2", title: "Free text", decision_payload: FREE_TEXT_PAYLOAD });
      const get = await app.inject({ method: "GET", url: "/api/decisions" });
      const body = get.json();
      const found = body.find((i: { id: string }) => i.id === "ft-2");
      expect(found).toBeDefined();
      expect(found.decision_payload.version).toBe("dostal:free-text/v1");
    });
  });

  describe("rating/v1 payloads (s5-freetext-rating-ranking-answer-shapes)", () => {
    const RATING_PAYLOAD = {
      version: "dostal:rating/v1" as const,
      title: "Rate the migration",
      context: "How did the cutover go?",
      prompt: "Rate 1-5",
      scale: { min: 1, max: 5, labels: { 1: "Poor", 5: "Excellent" } },
    };

    it("accepts and stores a rating/v1 payload", async () => {
      const res = await post({ id: "rt-1", title: "Rating", decision_payload: RATING_PAYLOAD });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.decision_payload).toEqual(RATING_PAYLOAD);
    });

    it("rejects a rating/v1 payload with an empty prompt", async () => {
      const res = await post({
        id: "rt-empty-prompt",
        title: "t",
        decision_payload: { ...RATING_PAYLOAD, prompt: "" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/prompt/i);
    });

    it("rejects a rating/v1 payload with invalid scale bounds (min >= max)", async () => {
      const res = await post({
        id: "rt-bad-scale",
        title: "t",
        decision_payload: { ...RATING_PAYLOAD, scale: { min: 5, max: 1 } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/scale/i);
    });

    it("rejects a rating/v1 payload with a missing scale", async () => {
      const { scale: _scale, ...withoutScale } = RATING_PAYLOAD;
      void _scale;
      const res = await post({ id: "rt-no-scale", title: "t", decision_payload: withoutScale });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/scale/i);
    });

    it("rating/v1 items show up in GET /api/decisions", async () => {
      await post({ id: "rt-2", title: "Rating", decision_payload: RATING_PAYLOAD });
      const get = await app.inject({ method: "GET", url: "/api/decisions" });
      const body = get.json();
      const found = body.find((i: { id: string }) => i.id === "rt-2");
      expect(found).toBeDefined();
      expect(found.decision_payload.version).toBe("dostal:rating/v1");
    });
  });

  describe("ranking/v1 payloads (s5-freetext-rating-ranking-answer-shapes)", () => {
    const RANKING_PAYLOAD = {
      version: "dostal:ranking/v1" as const,
      title: "Rank the launch priorities",
      context: "Order matters for the roadmap.",
      prompt: "Drag to rank",
      items: [
        { id: "perf", label: "Performance" },
        { id: "a11y", label: "Accessibility" },
      ],
    };

    it("accepts and stores a ranking/v1 payload", async () => {
      const res = await post({ id: "rk-1", title: "Ranking", decision_payload: RANKING_PAYLOAD });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.decision_payload).toEqual(RANKING_PAYLOAD);
    });

    it("rejects a ranking/v1 payload with an empty items list", async () => {
      const res = await post({
        id: "rk-empty",
        title: "t",
        decision_payload: { ...RANKING_PAYLOAD, items: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/items/i);
    });

    it("rejects a ranking/v1 payload whose item entry is missing a label", async () => {
      const res = await post({
        id: "rk-bad-item",
        title: "t",
        decision_payload: { ...RANKING_PAYLOAD, items: [{ id: "perf" }] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/items/i);
    });

    it("ranking/v1 items show up in GET /api/decisions", async () => {
      await post({ id: "rk-2", title: "Ranking", decision_payload: RANKING_PAYLOAD });
      const get = await app.inject({ method: "GET", url: "/api/decisions" });
      const body = get.json();
      const found = body.find((i: { id: string }) => i.id === "rk-2");
      expect(found).toBeDefined();
      expect(found.decision_payload.version).toBe("dostal:ranking/v1");
    });
  });

  describe("concept-selection/v1 payloads (s2-concept-selection-answer-shape)", () => {
    const CONCEPT_SELECTION_PAYLOAD = {
      version: "dostal:concept-selection/v1" as const,
      title: "Pick a logo concept",
      context: "Three directions from the brand explorer.",
      concepts: [
        {
          id: "geo",
          name: "Geometric",
          description: "Sharp angular mark.",
          preview: { kind: "svg" as const, markup: "<svg><rect width='10' height='10'/></svg>" },
        },
        {
          id: "script",
          name: "Script",
          description: "Flowing wordmark.",
          preview: { kind: "svg" as const, markup: "<svg><path d='M0 0'/></svg>" },
        },
      ],
    };

    it("accepts and stores a concept-selection/v1 payload", async () => {
      const res = await post({ id: "cs-1", title: "Logo concepts", decision_payload: CONCEPT_SELECTION_PAYLOAD });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.decision_payload).toEqual(CONCEPT_SELECTION_PAYLOAD);
    });

    it("rejects a concept-selection/v1 payload with an empty concepts array", async () => {
      const res = await post({
        id: "cs-empty",
        title: "t",
        decision_payload: { ...CONCEPT_SELECTION_PAYLOAD, concepts: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/concept/i);
    });

    it("rejects a concept-selection/v1 payload whose concept entry is missing id/name", async () => {
      const res = await post({
        id: "cs-bad-concept",
        title: "t",
        decision_payload: {
          ...CONCEPT_SELECTION_PAYLOAD,
          concepts: [{ description: "no id or name", preview: { kind: "svg", markup: "<svg/>" } }],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/concept/i);
    });

    it("rejects a concept-selection/v1 payload with an unrecognized preview.kind", async () => {
      const res = await post({
        id: "cs-bad-preview",
        title: "t",
        decision_payload: {
          ...CONCEPT_SELECTION_PAYLOAD,
          concepts: [
            {
              id: "geo",
              name: "Geometric",
              description: "Sharp angular mark.",
              preview: { kind: "png", markup: "<svg/>" },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/concept/i);
    });

    it("concept-selection/v1 items show up in GET /api/decisions", async () => {
      await post({ id: "cs-2", title: "Logo concepts", decision_payload: CONCEPT_SELECTION_PAYLOAD });
      const get = await app.inject({ method: "GET", url: "/api/decisions" });
      const body = get.json();
      const found = body.find((i: { id: string }) => i.id === "cs-2");
      expect(found).toBeDefined();
      expect(found.decision_payload.version).toBe("dostal:concept-selection/v1");
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
