import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { writeCommentAndCache } from "../adapters/multica/write-comment.js";
import type { MulticaClient } from "../adapters/multica/client.js";

export interface QuestionRoutesOptions {
  db: Database.Database;
  client: MulticaClient;
}

interface CreateQuestionBody {
  agent_id?: unknown;
  agent_name?: unknown;
  context?: unknown;
  question?: unknown;
  parked_workflow_id?: unknown;
  callback_url?: unknown;
}

interface AnswerQuestionBody {
  answer?: unknown;
  actor?: unknown;
}

interface ParkedQuestionRow {
  id: string;
  agent_id: string;
  agent_name: string;
  context: string | null;
  question: string;
  parked_workflow_id: string | null;
  callback_url: string | null;
  multica_issue_id: string | null;
  resolved: number;
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  created_at: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function composeQuestionIssueBody(input: {
  agentId: string;
  agentName: string;
  question: string;
  context: string | null;
  parkedWorkflowId: string | null;
  callbackUrl: string | null;
}): string {
  const lines = [
    "## Parked Question",
    "",
    input.question,
    "",
    "## Agent",
    "",
    `- Name: ${input.agentName}`,
    `- ID: ${input.agentId}`,
  ];

  if (input.context) {
    lines.push("", "## Context", "", input.context);
  }
  if (input.parkedWorkflowId) {
    lines.push("", `Parked workflow ID: ${input.parkedWorkflowId}`);
  }
  if (input.callbackUrl) {
    lines.push(`Callback URL: ${input.callbackUrl}`);
  }

  return lines.join("\n");
}

function composeAnswerComment(input: {
  question: ParkedQuestionRow;
  answer: string;
  actor: string;
  timestamp: string;
}): string {
  return [
    "## Answer",
    "",
    input.answer,
    "",
    "## Original Question",
    "",
    input.question.question,
    "",
    `Answered by: ${input.actor}`,
    `Timestamp: ${input.timestamp}`,
  ].join("\n");
}

function ensureQuestionItem(db: Database.Database, input: { issueId: string; title: string; body: string; now: string }): void {
  db.prepare(
    `INSERT INTO items (id, type, title, status, source_body, created_at, updated_at, triage_bucket)
     VALUES (?, 'multica_issue', ?, 'open', ?, ?, ?, 'open_question')
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       source_body = excluded.source_body,
       updated_at = excluded.updated_at,
       triage_bucket = excluded.triage_bucket`,
  ).run(`multica:${input.issueId}`, input.title, input.body, input.now, input.now);
}

async function postCallback(url: string, payload: unknown): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // Callback delivery is best-effort; the durable Multica comment + SQLite
    // resolution are the source of truth for v1.
  } finally {
    clearTimeout(timer);
  }
}

export function registerQuestionRoutes(app: FastifyInstance, { db, client }: QuestionRoutesOptions): void {
  app.post<{ Body: CreateQuestionBody }>("/api/questions", async (request, reply) => {
    const body = request.body ?? {};
    const agentId = nonEmptyString(body.agent_id);
    const agentName = nonEmptyString(body.agent_name);
    const question = nonEmptyString(body.question);
    if (!agentId || !agentName || !question) {
      reply.code(400);
      return { error: "agent_id, agent_name, and question are required" };
    }

    const context = optionalString(body.context);
    const parkedWorkflowId = optionalString(body.parked_workflow_id);
    const callbackUrl = optionalString(body.callback_url);
    const questionId = `question-${randomUUID()}`;
    const title = `[Question] ${truncate(question, 80)}`;
    const issueBody = composeQuestionIssueBody({
      agentId,
      agentName,
      question,
      context,
      parkedWorkflowId,
      callbackUrl,
    });

    db.prepare(
      `INSERT INTO parked_questions
       (id, agent_id, agent_name, context, question, parked_workflow_id, callback_url, resolved)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(questionId, agentId, agentName, context, question, parkedWorkflowId, callbackUrl);

    const issueResult = await client.createIssue({
      title,
      body: issueBody,
      labels: ["hive:question"],
    });
    if (!issueResult.ok) {
      reply.code(503);
      return { error: `Multica issue create failed: ${issueResult.error}` };
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE parked_questions SET multica_issue_id = ? WHERE id = ?").run(issueResult.issueId, questionId);
    ensureQuestionItem(db, { issueId: issueResult.issueId, title, body: issueBody, now });

    reply.code(201);
    return { question_id: questionId, multica_issue_id: issueResult.issueId };
  });

  app.get("/api/questions", async () => {
    return db
      .prepare("SELECT * FROM parked_questions WHERE resolved = 0 ORDER BY created_at ASC")
      .all() as ParkedQuestionRow[];
  });

  app.post<{ Params: { id: string }; Body: AnswerQuestionBody }>("/api/questions/:id/answer", async (request, reply) => {
    const body = request.body ?? {};
    const answer = nonEmptyString(body.answer);
    if (!answer) {
      reply.code(400);
      return { error: "answer is required" };
    }

    const question = db.prepare("SELECT * FROM parked_questions WHERE id = ?").get(request.params.id) as
      | ParkedQuestionRow
      | undefined;
    if (!question || question.resolved !== 0) {
      reply.code(404);
      return { error: "question not found" };
    }
    if (!question.multica_issue_id) {
      reply.code(503);
      return { error: "Multica issue is unavailable for this question" };
    }

    const actor = optionalString(body.actor) ?? "consus";
    const timestamp = new Date().toISOString();
    const commentBody = composeAnswerComment({ question, answer, actor, timestamp });
    ensureQuestionItem(db, {
      issueId: question.multica_issue_id,
      title: `[Question] ${truncate(question.question, 80)}`,
      body: question.context ?? question.question,
      now: timestamp,
    });

    const commentResult = await writeCommentAndCache(db, client, {
      itemId: question.multica_issue_id,
      cacheItemId: `multica:${question.multica_issue_id}`,
      author: actor,
      body: commentBody,
    });
    if (!commentResult.ok) {
      reply.code(503);
      return { error: `Multica comment write failed: ${commentResult.error}` };
    }

    db.prepare(
      "UPDATE parked_questions SET resolved = 1, answer = ?, answered_by = ?, answered_at = ? WHERE id = ?",
    ).run(answer, actor, timestamp, question.id);

    if (question.callback_url) {
      void postCallback(question.callback_url, {
        question_id: question.id,
        answer,
        actor,
        comment_id: commentResult.commentId,
      });
    }

    return { ok: true, comment_id: commentResult.commentId };
  });
}
