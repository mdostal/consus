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


  // Park a question from a god (Minerva) into the human inbox. Upserts the item (FK), inserts a pending human_request.
  app.post<{ Body: { item_id: string; item_title?: string; minerva_question_id?: string; text: string; channel?: string; reason?: string; confidence?: number; suggested_channel?: string } }>("/api/questions", async (request, reply) => {
    const b = request.body ?? ({} as Record<string, unknown>);
    if (typeof b.text !== "string" || b.text.trim().length === 0) { reply.code(400); return { error: "text is required" }; }
    if (typeof b.item_id !== "string" || b.item_id.length === 0) { reply.code(400); return { error: "item_id is required" }; }
    const mqid = (typeof b.minerva_question_id === "string" && b.minerva_question_id) ? b.minerva_question_id : `mq-${Date.now()}`;
    const now = new Date().toISOString();
    try {
      db.prepare("INSERT OR IGNORE INTO items (id, type, title, status, created_at, updated_at) VALUES (?, 'question', ?, 'open', ?, ?)").run(b.item_id, b.item_title || b.item_id, now, now);
      const r = db.prepare("INSERT INTO human_requests (item_id, minerva_question_id, text, channel, reason, confidence, suggested_channel, status, created_at) VALUES (?,?,?,?,?,?,?,'pending',?)").run(b.item_id, mqid, b.text, b.channel || "consus", b.reason ?? null, b.confidence ?? null, b.suggested_channel ?? null, now);
      // Link a parked_workflow so answering can RESUME the parked run (question_id -> human_request.id).
      try {
        db.prepare("INSERT INTO parked_workflows (id, agent_name, workflow_type, parked_state, status, question_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(`pw-${r.lastInsertRowid}`, b.channel || "minerva", "planning", String(b.item_id), "parked", String(r.lastInsertRowid), now, now);
      } catch { /* parked_workflows link is best-effort */ }
      return { id: r.lastInsertRowid, minerva_question_id: mqid, parked: true };
    } catch (e) { reply.code(500); return { error: (e as Error).message }; }
  });


  // Single question by id — the Minerva poller reads this to detect answered/status + fetch the answer.
  app.get<{ Params: { id: string } }>("/api/questions/:id", async (request, reply) => {
    const row = db
      .prepare("SELECT id, item_id, minerva_question_id, text, channel, reason, confidence, suggested_channel, answer, status, created_at FROM human_requests WHERE CAST(id AS TEXT) = ?")
      .get(request.params.id) as QuestionRow | undefined;
    if (!row) { reply.code(404); return { error: "question not found" }; }
    return row;
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
      // Multica comment is a best-effort notification. In standalone mode (or if the Multica
      // write is unavailable) still COMMIT the answer + workflow resume — never drop the human answer.
      db.prepare("COMMIT").run();

      return {
        ok: true,
        question_id: question.id,
        comment_id: commentResult.ok ? commentResult.commentId : null,
        multica_notified: commentResult.ok,
        workflow_status: workflowUpdate.changes > 0 ? "resumed" : null,
      };
    } catch (err) {
      rollbackIfActive(db);
      reply.code(502);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
