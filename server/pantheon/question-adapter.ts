import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Verdict } from "../decision-contract/parser.js";

// --- Pantheon feed types ---

interface QuestionItem {
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

// --- Pull ---

/**
 * Pull pending questions from Pantheon's feed and create one survey per
 * question ticket, with one decision item per question. Idempotent: tickets
 * already tracked in question_links are skipped without error.
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
    // Skip already-imported tickets (idempotency guard)
    const existing = db
      .prepare("SELECT item_id FROM question_links WHERE ticket_id = ? LIMIT 1")
      .get(ticket.ticket_id);
    if (existing) continue;

    // Skip tickets with no questions we can map
    const mappable = ticket.questions.filter((q) => buildDecisionPayload(q) !== null);
    if (mappable.length === 0) continue;

    const surveyId = randomUUID();
    const now = new Date().toISOString();

    db.prepare("INSERT INTO surveys (id, title, description, created_at) VALUES (?, ?, ?, ?)").run(
      surveyId,
      `Questions: ${ticket.identifier ?? ticket.ticket_id}`,
      null,
      now,
    );

    for (const q of mappable) {
      const payload = buildDecisionPayload(q)!;
      const itemId = randomUUID();
      db.prepare(
        `INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload, survey_id)
         VALUES (?, 'decision_request', ?, 'open', ?, ?, ?, ?)`,
      ).run(itemId, q.text, now, now, JSON.stringify(payload), surveyId);

      db.prepare(
        "INSERT INTO question_links (item_id, ticket_id, qid, survey_id) VALUES (?, ?, ?, ?)",
      ).run(itemId, ticket.ticket_id, q.qid, surveyId);
    }

    surveysCreated++;
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
