import type Database from "better-sqlite3";
import type { Verdict } from "../decision-contract/parser.js";
import { recordSyncFailure, recordSyncSuccess, safeRecord } from "./sync-status.js";

/**
 * The answer half of the question seam, still addressed to Pantheon: a verdict
 * on an item imported through POST /api/questions/import (server/questions/
 * import.ts) is written to the question_deliveries outbox and POSTed to
 * `${PANTHEON_API_URL}/api/feed/questions/:ticket/{partial,submit}`.
 * PANT-969 removed the pullers and the Pantheon transport; this push stays
 * until Pantheon can take answers on a generic seam.
 */

export interface AnswerDeliveryOptions {
  pantheonApiUrl: string;
  fetch?: typeof globalThis.fetch;
}

// --- Link lookup ---

export interface QuestionLink {
  ticketId: string;
  qid: string;
  surveyId: string;
}

export function getQuestionLink(db: Database.Database, itemId: string): QuestionLink | null {
  const row = db
    .prepare("SELECT ticket_id, qid, survey_id FROM question_links WHERE item_id = ?")
    .get(itemId) as { ticket_id: string; qid: string; survey_id: string } | undefined;
  if (!row) return null;
  return { ticketId: row.ticket_id, qid: row.qid, surveyId: row.survey_id };
}

// --- Verdict → answer string ---

/**
 * Maps a verdict to the answer string Pantheon records for the question.
 * Returns null when the verdict has no meaning for the item's payload —
 * today that is `accepted` on anything but a decision-request with a
 * `recommended` option (feature-selection, free-text), which used to be sent
 * as the literal string "accepted".
 */
function verdictToAnswer(verdict: Verdict, decisionPayloadJson: string | null): string | null {
  switch (verdict.kind) {
    case "accepted": {
      if (!decisionPayloadJson) return null;
      const p = JSON.parse(decisionPayloadJson) as { version?: string; recommended?: string };
      if (p.version === "dostal:decision-request/v1" && p.recommended) return p.recommended;
      return null;
    }
    case "option_chosen":
      return verdict.optionId;
    case "mix":
      return `${verdict.optionIds.join(", ")} — ${verdict.why}`;
    case "features_selected":
      return verdict.selected.join(", ");
    case "text_response":
      return verdict.text;
    case "rated":
      return String(verdict.value);
    case "ranked":
      return verdict.order.join(" > ");
    case "concept_selected":
      return verdict.conceptId;
    case "rejected_iteration_requested":
      return `(reopened) ${verdict.commentary}`;
  }
}

/**
 * The answer a verdict on a question-linked item would send, or null when the
 * verdict is meaningless for that item's payload (the verdict route refuses
 * it with a 400 rather than recording something Pantheon can't use).
 */
export function questionAnswerFor(db: Database.Database, itemId: string, verdict: Verdict): string | null {
  const item = db
    .prepare("SELECT decision_payload FROM items WHERE id = ?")
    .get(itemId) as { decision_payload: string | null } | undefined;
  return verdictToAnswer(verdict, item?.decision_payload ?? null);
}

// --- Delivery outbox (question_deliveries) ---

interface DeliveryRow {
  id: number;
  ticket_id: string;
  qid: string | null;
  kind: "partial" | "submit";
  body: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
}

export interface DeliveryResult {
  delivered: number;
  failed: number;
  /** Rows left pending this pass: already in flight, or a submit waiting on an undelivered partial. */
  skipped: number;
}

// Row ids currently being POSTed by this process. Guards against the verdict
// path and a concurrent redeliver pass sending the same row twice.
const inFlight = new Set<number>();

/**
 * Writes the outbox rows for a verdict on a question-linked item: one partial
 * for this question and, the first time every survey member is decided, one
 * submit for the ticket. Synchronous so the verdict route can call it inside
 * its own transaction. Returns the row ids to deliver.
 *
 * - An undelivered partial for the same (ticket, qid) is overwritten rather
 *   than queued behind, so a redelivery never sends a stale answer.
 * - Submit is enqueued at most once per ticket: once any submit row exists
 *   (pending, failed or delivered) a later verdict only adds a partial.
 */
export function enqueueQuestionVerdict(
  db: Database.Database,
  itemId: string,
  verdict: Verdict,
  actor: string,
): number[] {
  const link = getQuestionLink(db, itemId);
  if (!link) return [];

  const answer = questionAnswerFor(db, itemId, verdict);
  if (answer === null) {
    throw new Error(`verdict "${verdict.kind}" has no answer for question ${link.qid}`);
  }

  const now = new Date().toISOString();
  const ids: number[] = [];
  const partialBody = JSON.stringify({ qid: link.qid, answer, actor });

  const undelivered = db
    .prepare(
      "SELECT id FROM question_deliveries WHERE ticket_id = ? AND qid = ? AND kind = 'partial' AND status != 'delivered' ORDER BY id DESC LIMIT 1",
    )
    .get(link.ticketId, link.qid) as { id: number } | undefined;
  if (undelivered) {
    db.prepare(
      "UPDATE question_deliveries SET item_id = ?, body = ?, status = 'pending', updated_at = ? WHERE id = ?",
    ).run(itemId, partialBody, now, undelivered.id);
    ids.push(undelivered.id);
  } else {
    const info = db
      .prepare(
        `INSERT INTO question_deliveries (item_id, ticket_id, qid, kind, body, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, 'partial', ?, 'pending', 0, ?, ?)`,
      )
      .run(itemId, link.ticketId, link.qid, partialBody, now, now);
    ids.push(Number(info.lastInsertRowid));
  }

  const { total, answered } = db
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(decided_at) AS answered
       FROM items WHERE survey_id = ? AND decision_payload IS NOT NULL`,
    )
    .get(link.surveyId) as { total: number; answered: number };

  const submitExists = db
    .prepare("SELECT 1 FROM question_deliveries WHERE ticket_id = ? AND kind = 'submit' LIMIT 1")
    .get(link.ticketId);

  if (total > 0 && answered >= total && !submitExists) {
    const info = db
      .prepare(
        `INSERT INTO question_deliveries (item_id, ticket_id, qid, kind, body, status, attempts, created_at, updated_at)
         VALUES (?, ?, NULL, 'submit', ?, 'pending', 0, ?, ?)`,
      )
      .run(itemId, link.ticketId, JSON.stringify({ actor }), now, now);
    ids.push(Number(info.lastInsertRowid));
  }

  return ids;
}

async function deliverRow(db: Database.Database, row: DeliveryRow, opts: AnswerDeliveryOptions): Promise<boolean> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const url = `${opts.pantheonApiUrl}/api/feed/questions/${row.ticket_id}/${row.kind}`;

  let error: string | null = null;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: row.body,
    });
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const now = new Date().toISOString();
  if (error === null) {
    // The body may have been overwritten by a newer verdict while this POST
    // was in flight; only the body we actually sent counts as delivered.
    db.prepare(
      `UPDATE question_deliveries
       SET status = CASE WHEN body = ? THEN 'delivered' ELSE 'pending' END,
           attempts = attempts + 1, last_error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(row.body, now, row.id);
    safeRecord(() => recordSyncSuccess(db, "question_push"));
    return true;
  }

  db.prepare(
    "UPDATE question_deliveries SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?",
  ).run(error, now, row.id);
  // Also counted in GET /api/metrics's pantheon.undelivered_answers.
  safeRecord(() => recordSyncFailure(db, "question_push", `${row.kind} ${row.ticket_id}: ${error}`));
  console.warn("[answer-delivery] Pantheon delivery failed", {
    ticket: row.ticket_id,
    qid: row.qid,
    kind: row.kind,
    attempts: row.attempts + 1,
    error,
  });
  return false;
}

/**
 * Attempts delivery of the given outbox rows, oldest first. Never throws:
 * failures are recorded on the row. A submit is held back while its ticket
 * still has an undelivered partial, so Pantheon never closes a ticket missing
 * an answer.
 */
export async function deliverQuestionDeliveries(
  db: Database.Database,
  ids: number[],
  opts: AnswerDeliveryOptions,
): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, failed: 0, skipped: 0 };
  const getRow = db.prepare(
    "SELECT id, ticket_id, qid, kind, body, status, attempts FROM question_deliveries WHERE id = ?",
  );
  const undeliveredPartial = db.prepare(
    "SELECT 1 FROM question_deliveries WHERE ticket_id = ? AND kind = 'partial' AND status != 'delivered' LIMIT 1",
  );

  for (const id of [...ids].sort((a, b) => a - b)) {
    const row = getRow.get(id) as DeliveryRow | undefined;
    if (!row || row.status === "delivered") continue;
    if (inFlight.has(id) || (row.kind === "submit" && undeliveredPartial.get(row.ticket_id))) {
      result.skipped++;
      continue;
    }
    inFlight.add(id);
    try {
      if (await deliverRow(db, row, opts)) result.delivered++;
      else result.failed++;
    } finally {
      inFlight.delete(id);
    }
  }
  return result;
}

/**
 * Retries every pending or failed outbox row. Runs once at server startup and
 * on POST /api/questions/redeliver — deliberately not on a timer.
 */
export async function redeliverQuestionDeliveries(
  db: Database.Database,
  opts: AnswerDeliveryOptions,
): Promise<DeliveryResult> {
  const ids = (
    db.prepare("SELECT id FROM question_deliveries WHERE status != 'delivered' ORDER BY id ASC").all() as Array<{
      id: number;
    }>
  ).map((r) => r.id);
  return deliverQuestionDeliveries(db, ids, opts);
}

// --- Post partial / submit ---

/**
 * Enqueues the outbox rows for a question-linked verdict and attempts their
 * delivery. Callers that also write the verdict should instead call
 * enqueueQuestionVerdict inside their own transaction, then
 * deliverQuestionDeliveries — see the verdict route.
 */
export async function postQuestionVerdict(
  db: Database.Database,
  itemId: string,
  verdict: Verdict,
  actor: string,
  opts: AnswerDeliveryOptions,
): Promise<DeliveryResult> {
  const ids = db.transaction(() => enqueueQuestionVerdict(db, itemId, verdict, actor))();
  return deliverQuestionDeliveries(db, ids, opts);
}
