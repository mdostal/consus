import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Verdict } from "../decision-contract/parser.js";

// --- Pantheon feed types ---

export interface QuestionItem {
  qid: string;
  text: string;
  kind: string;
  options?: string[];
}

interface QuestionTicket {
  ticket_id: string;
  identifier: string | null;
  status: string;
  questions: QuestionItem[];
}

interface QuestionsFeedResponse {
  questions: QuestionTicket[];
}

export interface QuestionAdapterOptions {
  pantheonApiUrl: string;
  fetch?: typeof globalThis.fetch;
}

// --- Payload mapping ---

// Maps a Pantheon question kind to the corresponding Consus decision payload.
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

// --- Import (shared by pull and push) ---

/** One Pantheon question ticket, as carried by the feed and by
 *  POST /api/questions/import. */
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
 * Both the feed puller and POST /api/questions/import go through here.
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
  actor = "pantheon",
): CloseResult {
  const link = db
    .prepare("SELECT survey_id FROM question_links WHERE ticket_id = ? LIMIT 1")
    .get(ticketId) as { survey_id: string } | undefined;
  if (!link) return { found: false };

  const open = db
    .prepare(
      `SELECT i.id, i.status FROM items i
       JOIN question_links ql ON ql.item_id = i.id
       WHERE ql.ticket_id = ? AND i.decided_at IS NULL AND i.status != 'closed'`,
    )
    .all(ticketId) as Array<{ id: string; status: string }>;

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const item of open) {
      db.prepare("UPDATE items SET status = 'closed', updated_at = ? WHERE id = ?").run(now, item.id);
      db.prepare(
        "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(item.id, actor, "status", item.status, "closed", now);
      db.prepare("INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)").run(
        item.id,
        actor,
        `Closed upstream: ${reason}`,
        now,
      );
    }
  });
  tx();

  return { found: true, surveyId: link.survey_id, closedItemIds: open.map((i) => i.id) };
}

// --- Pull ---

/**
 * Pull pending questions from Pantheon's feed and import each ticket via
 * importQuestionTicket — the same path as POST /api/questions/import.
 */
export async function pullQuestions(
  db: Database.Database,
  opts: QuestionAdapterOptions,
): Promise<{ surveysCreated: number }> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const url = `${opts.pantheonApiUrl}/api/feed/questions?status=pending&surface=decision`;

  const res = await doFetch(url);
  if (!res.ok) throw new Error(`Pantheon questions fetch failed: ${res.status}`);
  const data = (await res.json()) as QuestionsFeedResponse;

  let surveysCreated = 0;
  for (const ticket of data.questions) {
    if (importQuestionTicket(db, ticket).status === "created") surveysCreated++;
  }

  return { surveysCreated };
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

function verdictToAnswer(verdict: Verdict, decisionPayloadJson: string | null): string {
  switch (verdict.kind) {
    case "accepted": {
      if (decisionPayloadJson) {
        const p = JSON.parse(decisionPayloadJson) as { recommended?: string };
        if (p.recommended) return p.recommended;
      }
      return "accepted";
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

// --- Post partial / submit ---

/**
 * Called from the verdict handler for question-linked items. Posts a partial
 * answer to Pantheon and, once all survey members are decided, posts submit.
 * Fire-and-forget safe: network failures are logged but never propagate to
 * the caller (same resilience contract as the decisions bridge).
 */
export async function postQuestionVerdict(
  db: Database.Database,
  itemId: string,
  verdict: Verdict,
  actor: string,
  opts: QuestionAdapterOptions,
): Promise<void> {
  const link = getQuestionLink(db, itemId);
  if (!link) return;

  const doFetch = opts.fetch ?? globalThis.fetch;

  const item = db
    .prepare("SELECT decision_payload FROM items WHERE id = ?")
    .get(itemId) as { decision_payload: string | null } | undefined;
  const answer = verdictToAnswer(verdict, item?.decision_payload ?? null);

  await doFetch(`${opts.pantheonApiUrl}/api/feed/questions/${link.ticketId}/partial`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qid: link.qid, answer, actor }),
  });

  // Post submit once all survey members have a decided_at
  const { total } = db
    .prepare(
      "SELECT COUNT(*) AS total FROM items WHERE survey_id = ? AND decision_payload IS NOT NULL",
    )
    .get(link.surveyId) as { total: number };

  const { answered } = db
    .prepare(
      "SELECT COUNT(*) AS answered FROM items WHERE survey_id = ? AND decision_payload IS NOT NULL AND decided_at IS NOT NULL",
    )
    .get(link.surveyId) as { answered: number };

  if (total > 0 && answered >= total) {
    await doFetch(`${opts.pantheonApiUrl}/api/feed/questions/${link.ticketId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor }),
    });
  }
}
