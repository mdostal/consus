import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerSurveyRoutes } from "./surveys.js";
import { registerDecisionRoutes } from "./decisions.js";

const VALID_PAYLOAD = {
  version: "dostal:decision-request/v1",
  title: "q",
  context: "",
  options: [
    { id: "A", title: "Yes", tradeoffs: "" },
    { id: "B", title: "No", tradeoffs: "" },
  ],
  recommended: "A",
};

function insertDecision(db: Database.Database, id: string, surveyId: string | null = null) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload, survey_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, "decision_request", `Decision ${id}`, "open", now, now, JSON.stringify(VALID_PAYLOAD), surveyId);
}

describe("GET /api/surveys", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerSurveyRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("returns an empty array when no surveys exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/surveys" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns surveys with id, title, description, created_at, total, and answered fields", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Shape check survey" },
    });
    const { id } = create.json();

    const res = await app.inject({ method: "GET", url: "/api/surveys" });
    expect(res.statusCode).toBe(200);
    const surveys = res.json();
    expect(surveys).toHaveLength(1);
    const s = surveys[0];
    expect(s.id).toBe(id);
    expect(s.title).toBe("Shape check survey");
    expect(s).toHaveProperty("description");
    expect(s).toHaveProperty("created_at");
    expect(s.total).toBe(0);
    expect(s.answered).toBe(0);
  });

  it("reports answered/total counts correctly", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Count survey" },
    });
    const surveyId = create.json().id;

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload, survey_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("d-open", "decision_request", "Open Q", "open", now, now, JSON.stringify(VALID_PAYLOAD), surveyId);
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload, decided_at, survey_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("d-done", "decision_request", "Done Q", "approved", now, now, JSON.stringify(VALID_PAYLOAD), now, surveyId);

    const res = await app.inject({ method: "GET", url: "/api/surveys" });
    const survey = res.json()[0];
    expect(survey.total).toBe(2);
    expect(survey.answered).toBe(1);
  });

  it("does not count items without decision_payload in totals", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Non-decision survey" },
    });
    const surveyId = create.json().id;
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at, survey_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("non-decision", "doc_ref", "Not a Q", "open", now, now, surveyId);

    const res = await app.inject({ method: "GET", url: "/api/surveys" });
    const survey = res.json()[0];
    expect(survey.total).toBe(0);
    expect(survey.answered).toBe(0);
  });
});

describe("POST /api/surveys", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerSurveyRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("creates a survey and returns it with an empty members list when no decision_ids are given", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "My first survey" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.title).toBe("My first survey");
    expect(body.description).toBeNull();
    expect(body.created_at).toBeTruthy();
    expect(body.members).toEqual([]);
  });

  it("includes description when provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Survey with description", description: "All the questions" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.description).toBe("All the questions");
  });

  it("assigns pre-existing decisions to the survey when decision_ids are supplied", async () => {
    insertDecision(db, "d-1");
    insertDecision(db, "d-2");

    const res = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Batch survey", decision_ids: ["d-1", "d-2"] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.members.map((m: { id: string }) => m.id).sort()).toEqual(["d-1", "d-2"]);
    expect(body.members[0]).toMatchObject({ id: expect.any(String), title: expect.any(String), status: expect.any(String) });
  });

  it("silently skips unknown decision_ids (non-existent items are a no-op)", async () => {
    insertDecision(db, "d-real");

    const res = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Skip unknown", decision_ids: ["d-real", "d-ghost"] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.members.map((m: { id: string }) => m.id)).toEqual(["d-real"]);
  });

  it("silently skips items that exist but have no decision_payload", async () => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("non-decision", "doc_ref", "Not a decision", "open", now, now);

    const res = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Filter non-decisions", decision_ids: ["non-decision"] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.members).toHaveLength(0);
  });

  it("returns 400 when title is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { description: "no title" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/title/i);
  });
});

describe("GET /api/surveys/:id", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerSurveyRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("returns the survey with its member decisions", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Q&A session", decision_ids: [] },
    });
    const { id } = create.json();

    insertDecision(db, "d-member", id);

    const res = await app.inject({ method: "GET", url: `/api/surveys/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.title).toBe("Q&A session");
    expect(body.members).toHaveLength(1);
    expect(body.members[0].id).toBe("d-member");
  });

  it("returns 404 for an unknown survey id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/surveys/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/not found/i);
  });

  it("returns members with id, title, status, and decided_at fields", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Shape check" },
    });
    const { id } = create.json();
    insertDecision(db, "d-shape", id);

    const res = await app.inject({ method: "GET", url: `/api/surveys/${id}` });
    const member = res.json().members[0];
    expect(member).toHaveProperty("id");
    expect(member).toHaveProperty("title");
    expect(member).toHaveProperty("status");
    expect(member).toHaveProperty("decided_at");
  });
});

describe("GET /api/decisions?survey=<id>", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerSurveyRoutes(app, { db });
    registerDecisionRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("filters decisions to only those in the given survey", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Filtered survey" },
    });
    const surveyId = create.json().id;

    insertDecision(db, "in-survey", surveyId);
    insertDecision(db, "not-in-survey");

    const res = await app.inject({ method: "GET", url: `/api/decisions?survey=${surveyId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map((d: { id: string }) => d.id)).toEqual(["in-survey"]);
  });

  it("composes ?survey with ?all=1 to include decided items", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "All items survey" },
    });
    const surveyId = create.json().id;

    insertDecision(db, "open-in-survey", surveyId);

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload, decided_at, survey_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("decided-in-survey", "decision_request", "Decided", "approved", now, now, JSON.stringify(VALID_PAYLOAD), now, surveyId);

    const openOnly = await app.inject({ method: "GET", url: `/api/decisions?survey=${surveyId}` });
    expect(openOnly.json().map((d: { id: string }) => d.id)).toEqual(["open-in-survey"]);

    const all = await app.inject({ method: "GET", url: `/api/decisions?survey=${surveyId}&all=1` });
    expect(all.json().map((d: { id: string }) => d.id).sort()).toEqual(["decided-in-survey", "open-in-survey"].sort());
  });

  it("returns an empty list when no decisions belong to the survey", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Empty survey" },
    });
    const surveyId = create.json().id;

    const res = await app.inject({ method: "GET", url: `/api/decisions?survey=${surveyId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("POST /api/decisions with survey_id", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerSurveyRoutes(app, { db });
    registerDecisionRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("assigns the new decision to a survey when survey_id is provided", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/surveys",
      payload: { title: "Target survey" },
    });
    const surveyId = create.json().id;

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions",
      payload: { id: "d-in-survey", title: "Should we?", decision_payload: VALID_PAYLOAD, survey_id: surveyId },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().survey_id).toBe(surveyId);

    const row = db.prepare("SELECT survey_id FROM items WHERE id = ?").get("d-in-survey") as { survey_id: string };
    expect(row.survey_id).toBe(surveyId);
  });

  it("returns 400 when survey_id refers to a non-existent survey", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/decisions",
      payload: { id: "d-bad", title: "Orphan", decision_payload: VALID_PAYLOAD, survey_id: "does-not-exist" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/survey not found/i);
  });

  it("existing decisions without survey_id are unaffected — survey_id stays null", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/decisions",
      payload: { id: "d-no-survey", title: "No survey", decision_payload: VALID_PAYLOAD },
    });

    expect(res.statusCode).toBe(201);
    const row = db.prepare("SELECT survey_id FROM items WHERE id = ?").get("d-no-survey") as {
      survey_id: string | null;
    };
    expect(row.survey_id).toBeNull();
  });
});
