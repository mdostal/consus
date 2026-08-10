import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerQuestionRoutes } from "./questions.js";
import type { MulticaClient } from "../adapters/multica/client.js";

function makeClient(overrides: Partial<MulticaClient> = {}): MulticaClient {
  return {
    async writeComment() {
      return { ok: true, multicaCommentId: "comment-1" };
    },
    async createIssue() {
      return { ok: true, issueId: "issue-1", issueUrl: "https://multica.example/issues/PAN-1" };
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

describe("questions routes", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(async () => {
    if (app) await app.close();
    db.close();
  });

  async function buildApp(client: MulticaClient = makeClient()) {
    app = Fastify();
    registerQuestionRoutes(app, { db, client });
    await app.ready();
  }

  it("POST /api/questions creates a SQLite row and Multica issue with hive:question label", async () => {
    const createIssue = vi.fn().mockResolvedValue({
      ok: true,
      issueId: "issue-question-1",
      issueUrl: "https://multica.example/issues/PAN-1",
    });
    await buildApp(makeClient({ createIssue }));

    const res = await app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        agent_id: "agent-1",
        agent_name: "Minerva",
        question: "Which repo should receive the generated implementation?",
        context: "The planning pass found two plausible targets.",
        parked_workflow_id: "workflow-1",
        callback_url: "https://minerva.example/callback",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.question_id).toEqual(expect.stringMatching(/^question-/));
    expect(body.multica_issue_id).toBe("issue-question-1");
    expect(createIssue).toHaveBeenCalledWith({
      title: "[Question] Which repo should receive the generated implementation?",
      labels: ["hive:question"],
      body: expect.stringContaining("## Parked Question"),
    });
    const issueBody = createIssue.mock.calls[0][0].body;
    expect(issueBody).toContain("Which repo should receive the generated implementation?");
    expect(issueBody).toContain("- Name: Minerva");
    expect(issueBody).toContain("- ID: agent-1");
    expect(issueBody).toContain("The planning pass found two plausible targets.");

    const row = db.prepare("SELECT * FROM parked_questions WHERE id = ?").get(body.question_id) as {
      agent_id: string;
      agent_name: string;
      question: string;
      multica_issue_id: string;
      resolved: number;
    };
    expect(row).toMatchObject({
      agent_id: "agent-1",
      agent_name: "Minerva",
      question: "Which repo should receive the generated implementation?",
      multica_issue_id: "issue-question-1",
      resolved: 0,
    });
  });

  it("POST /api/questions rejects missing required fields", async () => {
    const createIssue = vi.fn();
    await buildApp(makeClient({ createIssue }));

    const res = await app.inject({
      method: "POST",
      url: "/api/questions",
      payload: { agent_id: "agent-1", question: "Missing name" },
    });

    expect(res.statusCode).toBe(400);
    expect(createIssue).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM parked_questions").get()).toEqual({ count: 0 });
  });

  it("GET /api/questions returns only unresolved questions ordered by created_at", async () => {
    await buildApp();
    db.prepare(
      `INSERT INTO parked_questions
       (id, agent_id, agent_name, question, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("question-1", "agent-1", "Minerva", "Open later", 0, "2026-08-10T02:00:00Z");
    db.prepare(
      `INSERT INTO parked_questions
       (id, agent_id, agent_name, question, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("question-2", "agent-1", "Minerva", "Resolved", 1, "2026-08-10T01:00:00Z");
    db.prepare(
      `INSERT INTO parked_questions
       (id, agent_id, agent_name, question, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("question-3", "agent-2", "Auriga", "Open first", 0, "2026-08-10T01:30:00Z");

    const res = await app.inject({ method: "GET", url: "/api/questions" });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((q: { id: string }) => q.id)).toEqual(["question-3", "question-1"]);
  });

  it("POST /api/questions/:id/answer writes a Multica comment, marks resolved, and removes it from the open list", async () => {
    const createIssue = vi.fn().mockResolvedValue({
      ok: true,
      issueId: "issue-question-2",
      issueUrl: "https://multica.example/issues/PAN-2",
    });
    const writeComment = vi.fn().mockResolvedValue({ ok: true, multicaCommentId: "comment-answer-1" });
    await buildApp(makeClient({ createIssue, writeComment }));

    const created = await app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        agent_id: "agent-1",
        agent_name: "Minerva",
        question: "Should this workflow continue?",
      },
    });
    const questionId = created.json().question_id;

    const res = await app.inject({
      method: "POST",
      url: `/api/questions/${questionId}/answer`,
      payload: { answer: "Yes, continue with the Consus repo.", actor: "mathew" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, comment_id: "comment-answer-1" });
    expect(writeComment).toHaveBeenCalledWith({
      itemId: "issue-question-2",
      author: "mathew",
      body: expect.stringContaining("Yes, continue with the Consus repo."),
    });
    expect(writeComment.mock.calls[0][0].body).toContain("Should this workflow continue?");

    const row = db.prepare("SELECT resolved, answer, answered_by, answered_at FROM parked_questions WHERE id = ?").get(
      questionId,
    ) as { resolved: number; answer: string; answered_by: string; answered_at: string };
    expect(row).toMatchObject({
      resolved: 1,
      answer: "Yes, continue with the Consus repo.",
      answered_by: "mathew",
    });
    expect(row.answered_at).toEqual(expect.any(String));
    expect(db.prepare("SELECT multica_comment_id FROM comments").get()).toEqual({
      multica_comment_id: "comment-answer-1",
    });

    const open = await app.inject({ method: "GET", url: "/api/questions" });
    expect(open.json()).toEqual([]);
  });

  it("POST /api/questions/:id/answer returns 404 for already resolved questions", async () => {
    const writeComment = vi.fn();
    await buildApp(makeClient({ writeComment }));
    db.prepare(
      `INSERT INTO parked_questions
       (id, agent_id, agent_name, question, multica_issue_id, resolved)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).run("question-resolved", "agent-1", "Minerva", "Already answered?", "issue-resolved");

    const res = await app.inject({
      method: "POST",
      url: "/api/questions/question-resolved/answer",
      payload: { answer: "Too late" },
    });

    expect(res.statusCode).toBe(404);
    expect(writeComment).not.toHaveBeenCalled();
  });

  it("returns 503 when Multica issue creation fails", async () => {
    await buildApp(makeClient({ createIssue: vi.fn().mockResolvedValue({ ok: false, error: "offline" }) }));

    const res = await app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        agent_id: "agent-1",
        agent_name: "Minerva",
        question: "Can anyone answer this?",
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "Multica issue create failed: offline" });
    const row = db.prepare("SELECT question, multica_issue_id FROM parked_questions").get() as {
      question: string;
      multica_issue_id: string | null;
    };
    expect(row).toEqual({ question: "Can anyone answer this?", multica_issue_id: null });
  });

  it("returns 503 when Multica comment write fails", async () => {
    await buildApp(makeClient({ writeComment: vi.fn().mockResolvedValue({ ok: false, error: "offline" }) }));
    db.prepare(
      `INSERT INTO parked_questions
       (id, agent_id, agent_name, question, multica_issue_id, resolved)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run("question-open", "agent-1", "Minerva", "Still open?", "issue-open");

    const res = await app.inject({
      method: "POST",
      url: "/api/questions/question-open/answer",
      payload: { answer: "Yes" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "Multica comment write failed: offline" });
    expect(db.prepare("SELECT resolved, answer FROM parked_questions WHERE id = ?").get("question-open")).toEqual({
      resolved: 0,
      answer: null,
    });
  });
});
