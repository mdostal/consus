import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { MulticaClient } from "../adapters/multica/client.js";
import { writeCommentAndCache } from "../adapters/multica/write-comment.js";

export interface QuestionRoutesOptions {
  db: Database.Database;
  client: MulticaClient;
}

interface QuestionRow {
  id: number;
  item_id: string;
  minerva_question_id: string;
  text: string;
  channel: string;
  reason: string | null;
  confidence: number | null;
  suggested_channel: string | null;
  answer: string | null;
  status: string;
  created_at: string | null;
}

interface AnswerRequestBody {
  answer?: unknown;
  actor?: unknown;
}

function remoteItemIdFor(itemId: string): string {
  return itemId.replace(/^multica:/, "");
}

function composeAnswerComment(input: { actor: string; answer: string }): string {
  return [`Question answered by ${input.actor}:`, "", input.answer].join("\n");
}

function rollbackIfActive(db: Database.Database): void {
  if (db.inTransaction) {
    db.prepare("ROLLBACK").run();
  }
}

export function registerQuestionRoutes(app: FastifyInstance, { db, client }: QuestionRoutesOptions): void {
  app.get("/api/questions", async () => {
    const rows = db
      .prepare(
        `SELECT id, item_id, minerva_question_id, text, channel, reason, confidence, suggested_channel, answer, status, created_at
         FROM human_requests
         WHERE status = 'pending'
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as QuestionRow[];

    return rows;
  });

  app.post<{ Params: { id: string }; Body: AnswerRequestBody }>("/api/questions/:id/answer", async (request, reply) => {
    const body = request.body ?? {};
    if (typeof body.answer !== "string" || body.answer.trim().length === 0) {
      reply.code(400);
      return { error: "answer is required" };
    }
    const actor = typeof body.actor === "string" && body.actor.trim().length > 0 ? body.actor : "consus";
    const answer = body.answer;
    const now = new Date().toISOString();

    try {
      db.prepare("BEGIN IMMEDIATE").run();

      const question = db
        .prepare(
          `SELECT id, item_id, minerva_question_id, text, channel, reason, confidence, suggested_channel, answer, status, created_at
           FROM human_requests
           WHERE CAST(id AS TEXT) = ?`,
        )
        .get(request.params.id) as QuestionRow | undefined;

      if (!question) {
        rollbackIfActive(db);
        reply.code(404);
        return { error: "question not found" };
      }

      if (question.status === "answered" || question.answer !== null) {
        rollbackIfActive(db);
        reply.code(409);
        return { error: "question already answered" };
      }

      if (question.status !== "pending") {
        rollbackIfActive(db);
        reply.code(409);
        return { error: `question is ${question.status}, not pending` };
      }

      db.prepare("UPDATE human_requests SET answer = ?, status = 'answered' WHERE id = ?").run(answer, question.id);
      db.prepare("UPDATE items SET status = 'answered', updated_at = ? WHERE id = ?").run(now, question.item_id);
      const workflowUpdate = db
        .prepare("UPDATE parked_workflows SET status = 'resumed', resumed_at = ? WHERE CAST(question_id AS TEXT) = ?")
        .run(now, String(question.id));

      const commentResult = await writeCommentAndCache(db, client, {
        itemId: remoteItemIdFor(question.item_id),
        cacheItemId: question.item_id,
        author: actor,
        body: composeAnswerComment({ actor, answer }),
      });
      if (!commentResult.ok) {
        throw new Error(`Multica comment write failed: ${commentResult.error}`);
      }

      db.prepare("COMMIT").run();

      return {
        ok: true,
        question_id: question.id,
        comment_id: commentResult.commentId,
        workflow_status: workflowUpdate.changes > 0 ? "resumed" : null,
      };
    } catch (err) {
      rollbackIfActive(db);
      reply.code(502);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
