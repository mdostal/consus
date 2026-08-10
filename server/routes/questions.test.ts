import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import type { MulticaClient } from "../adapters/multica/client.js";
import { registerQuestionRoutes } from "./questions.js";

function makeClient(overrides: Partial<MulticaClient> = {}): MulticaClient {
  return {
    async writeComment() {
      return { ok: true, multicaCommentId: "comment-1" };
    },
    async createIssue() {
      return { ok: false, error: "unused" };
    },
    async listIssues() {
      return { ok: true, issues: [] };
    },
    async getIssue() {
      return { ok: false, error: "unused" };
    },
    async updateIssueStatus() {
      return { ok: false, error: "unused" };
    },
    async unblockIssue() {
      return { ok: false, error: "unused" };
    },
    ...overrides,
  };
}

function insertQuestion(
  db: Database.Database,
  input: {
    itemId: string;
    minervaQuestionId: string;
    text: string;
    status?: string;
    createdAt: string;
    answer?: string | null;
  },
): number {
  db.prepare("INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    input.itemId,
    "human_request",
    input.text,
    input.status ?? "pending",
    input.createdAt,
    input.createdAt,
  );
  const result = db
    .prepare(
      `INSERT INTO human_requests (item_id, minerva_question_id, text, channel, reason, answer, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.itemId,
      input.minervaQuestionId,
      input.text,
      "architecture",
      null,
      input.answer ?? null,
      input.status ?? "pending",
      input.createdAt,
    );
  return Number(result.lastInsertRowid);
}

describe("question routes", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  async function buildApp(client: MulticaClient = makeClient()) {
    app = Fastify();
    registerQuestionRoutes(app, { db, client });
    await app.ready();
  }

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(async () => {
    if (app) await app.close();
    db.close();
  });

  it("lists pending questions ordered by created_at descending", async () => {
    await buildApp();
    const olderId = insertQuestion(db, {
      itemId: "multica:issue-old",
      minervaQuestionId: "q-old",
      text: "Older pending?",
      createdAt: "2026-08-10T01:00:00.000Z",
    });
    const newerId = insertQuestion(db, {
      itemId: "multica:issue-new",
      minervaQuestionId: "q-new",
      text: "Newer pending?",
      createdAt: "2026-08-10T02:00:00.000Z",
    });
    insertQuestion(db, {
      itemId: "multica:issue-answered",
      minervaQuestionId: "q-answered",
      text: "Already answered?",
      status: "answered",
      answer: "done",
      createdAt: "2026-08-10T03:00:00.000Z",
    });

    const res = await app.inject({ method: "GET", url: "/api/questions" });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((q: { id: number }) => q.id)).toEqual([newerId, olderId]);
  });

  it("answers a pending question, resumes the linked workflow, and writes the Multica comment", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: true, multicaCommentId: "comment-42" });
    await buildApp(makeClient({ writeComment }));
    const questionId = insertQuestion(db, {
      itemId: "multica:issue-1",
      minervaQuestionId: "q-1",
      text: "Ship it?",
      createdAt: "2026-08-10T01:00:00.000Z",
    });
    db.prepare(
      "INSERT INTO parked_workflows (id, agent_name, workflow_type, parked_state, question_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("workflow-1", "auriga", "build", JSON.stringify({ step: "blocked" }), String(questionId), "parked", "2026-08-10T01:00:00.000Z");

    const res = await app.inject({
      method: "POST",
      url: `/api/questions/${questionId}/answer`,
      payload: { answer: "Use the Consus repo.", actor: "mathew" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, question_id: questionId, comment_id: "comment-42", workflow_status: "resumed" });
    expect(writeComment).toHaveBeenCalledWith({
      itemId: "issue-1",
      author: "mathew",
      body: expect.stringContaining("Use the Consus repo."),
    });
    expect(db.prepare("SELECT answer, status FROM human_requests WHERE id = ?").get(questionId)).toEqual({
      answer: "Use the Consus repo.",
      status: "answered",
    });
    expect(db.prepare("SELECT status, resumed_at FROM parked_workflows WHERE id = ?").get("workflow-1")).toMatchObject({
      status: "resumed",
      resumed_at: expect.any(String),
    });
    expect(db.prepare("SELECT item_id, author, multica_comment_id FROM comments").get()).toEqual({
      item_id: "multica:issue-1",
      author: "mathew",
      multica_comment_id: "comment-42",
    });
  });

  it("returns 404 for an invalid question id", async () => {
    const writeComment = vi.fn();
    await buildApp(makeClient({ writeComment }));

    const res = await app.inject({
      method: "POST",
      url: "/api/questions/missing/answer",
      payload: { answer: "No", actor: "mathew" },
    });

    expect(res.statusCode).toBe(404);
    expect(writeComment).not.toHaveBeenCalled();
  });

  it("returns 409 and does not write a comment when the question is already answered", async () => {
    const writeComment = vi.fn();
    await buildApp(makeClient({ writeComment }));
    const questionId = insertQuestion(db, {
      itemId: "multica:issue-answered",
      minervaQuestionId: "q-answered",
      text: "Already answered?",
      status: "answered",
      answer: "previous",
      createdAt: "2026-08-10T01:00:00.000Z",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/questions/${questionId}/answer`,
      payload: { answer: "new", actor: "mathew" },
    });

    expect(res.statusCode).toBe(409);
    expect(writeComment).not.toHaveBeenCalled();
    expect(db.prepare("SELECT answer FROM human_requests WHERE id = ?").get(questionId)).toEqual({ answer: "previous" });
  });

  it("rolls back local updates when the Multica comment write fails", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: false, error: "HTTP 503" });
    await buildApp(makeClient({ writeComment }));
    const questionId = insertQuestion(db, {
      itemId: "multica:issue-rollback",
      minervaQuestionId: "q-rollback",
      text: "Rollback?",
      createdAt: "2026-08-10T01:00:00.000Z",
    });
    db.prepare(
      "INSERT INTO parked_workflows (id, agent_name, workflow_type, parked_state, question_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("workflow-rollback", "auriga", "build", "{}", String(questionId), "parked", "2026-08-10T01:00:00.000Z");

    const res = await app.inject({
      method: "POST",
      url: `/api/questions/${questionId}/answer`,
      payload: { answer: "No", actor: "mathew" },
    });

    expect(res.statusCode).toBe(502);
    expect(db.prepare("SELECT answer, status FROM human_requests WHERE id = ?").get(questionId)).toEqual({
      answer: null,
      status: "pending",
    });
    expect(db.prepare("SELECT status, resumed_at FROM parked_workflows WHERE id = ?").get("workflow-rollback")).toEqual({
      status: "parked",
      resumed_at: null,
    });
  });
});
