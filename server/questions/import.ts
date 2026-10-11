import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { closeOpenItems } from "../kb/store.js";

/**
 * The generic question seam: an outside system pushes a ticket of questions
 * in over POST /api/questions/import (and closes it with
 * POST /api/questions/:ticket/close); each question becomes a decision item in
 * one survey, linked back through question_links. Nothing here knows who the
 * caller is. Answers go back through server/pantheon/answer-delivery.ts.
 */

export interface QuestionItem {
  qid: string;
  text: string;
  kind: string;
  options?: string[];
}

// --- Payload mapping ---

// Maps a question kind to the corresponding Consus decision payload.
// Returns null when the kind is unrecognized or lacks required options.
function buildDecisionPayload(q: QuestionItem): object | null {
  switch (q.kind) {
    case "single-select": {
      const opts = q.options ?? [];
      if (opts.length < 2) return null;
      const options = opts.map((label, i) => ({
        id: String.fromCharCode(65 + i), // A, B, C, ...
        title: label,
        tradeoffs: "",
      }));
      return {
        version: "dostal:decision-request/v1",
        title: q.text,
        context: q.text,
        options,
        recommended: options[0].id,
      };
    }
    case "multi": {
      const opts = q.options ?? [];
      if (opts.length < 1) return null;
      return {
        version: "dostal:feature-selection/v1",
        title: q.text,
        context: q.text,
        features: opts.map((label, i) => ({
          id: `f${i}`,
          name: label,
          description: label,
        })),
      };
    }
    case "free-text":
    case "free text": {
      return {
        version: "dostal:free-text/v1",
        title: q.text,
        context: q.text,
        prompt: q.text,
      };
    }
    default:
      return null;
  }
}

// --- Import ---

/** One question ticket, as carried by POST /api/questions/import. */
export interface QuestionTicketInput {
  ticket_id: string;
  identifier?: string | null;
  questions: QuestionItem[];
}

export type ImportResult =
  | { status: "created"; surveyId: string; itemIds: string[] }
  | { status: "exists"; surveyId: string }
  | { status: "unmappable" };

/**
 * Import one question ticket as a survey with one decision item per question
 * we can map to an answer shape. Idempotent on ticket_id: a ticket already
 * tracked in question_links returns its existing survey without writing.
 */
export function importQuestionTicket(db: Database.Database, ticket: QuestionTicketInput): ImportResult {
  const existing = db
    .prepare("SELECT survey_id FROM question_links WHERE ticket_id = ? LIMIT 1")
    .get(ticket.ticket_id) as { survey_id: string } | undefined;
  if (existing) return { status: "exists", surveyId: existing.survey_id };

  const mapped = ticket.questions
    .map((q) => ({ q, payload: buildDecisionPayload(q) }))
    .filter((m): m is { q: QuestionItem; payload: object } => m.payload !== null);
  if (mapped.length === 0) return { status: "unmappable" };

  const surveyId = randomUUID();
  const now = new Date().toISOString();
  const itemIds: string[] = [];

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO surveys (id, title, description, created_at) VALUES (?, ?, ?, ?)").run(
      surveyId,
      `Questions: ${ticket.identifier ?? ticket.ticket_id}`,
      null,
      now,
    );

    for (const { q, payload } of mapped) {
      const itemId = randomUUID();
      db.prepare(
        `INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload, survey_id)
         VALUES (?, 'decision_request', ?, 'open', ?, ?, ?, ?)`,
      ).run(itemId, q.text, now, now, JSON.stringify(payload), surveyId);

      db.prepare(
        "INSERT INTO question_links (item_id, ticket_id, qid, survey_id) VALUES (?, ?, ?, ?)",
      ).run(itemId, ticket.ticket_id, q.qid, surveyId);
      itemIds.push(itemId);
    }
  });
  tx();

  return { status: "created", surveyId, itemIds };
}

// --- Close ---

export type CloseResult =
  | { found: false }
  | { found: true; surveyId: string; closedItemIds: string[] };

/**
 * Close every still-open item linked to a question ticket — for a ticket that
 * was cancelled or answered somewhere other than Consus. Nothing is deleted:
 * each closed item gets status 'closed', an audit_log row, and a comment
 * carrying the reason. Already-decided or already-closed items are left
 * alone, so a repeat call is a no-op.
 */
export function closeQuestionTicket(
  db: Database.Database,
  ticketId: string,
  reason: string,
  actor = "upstream",
): CloseResult {
  const link = db
    .prepare("SELECT survey_id FROM question_links WHERE ticket_id = ? LIMIT 1")
    .get(ticketId) as { survey_id: string } | undefined;
  if (!link) return { found: false };

  const linked = db
    .prepare("SELECT item_id FROM question_links WHERE ticket_id = ? ORDER BY rowid")
    .all(ticketId) as Array<{ item_id: string }>;
  const closedItemIds = closeOpenItems(
    db,
    linked.map((l) => l.item_id),
    actor,
    `Closed upstream: ${reason}`,
  );

  return { found: true, surveyId: link.survey_id, closedItemIds };
}
