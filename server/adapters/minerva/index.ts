import type Database from "better-sqlite3";
import type { MinervaTransport } from "./transport.js";

export interface Question {
  id: string;
  text: string;
  channel: string;
  reason: string | null;
  status: string;
  /** Escalation-classifier output, when Minerva provides it. */
  confidence?: number;
  suggestedChannel?: string;
}

export interface HumanRequestRow {
  id: number;
  item_id: string;
  minerva_question_id: string;
  text: string;
  channel: string;
  reason: string | null;
  confidence: number | null;
  suggested_channel: string | null;
  status: string;
}

function itemIdFor(minervaQuestionId: string): string {
  return `human_request:${minervaQuestionId}`;
}

/**
 * REQ-01: ingest a Minerva Question, storing it verbatim as a human_request
 * item, and populate a decision_payload translation (REQ-11) so it renders
 * through decision-card-renderer-ui's shared path instead of a bespoke UI.
 * Unknown channels are preserved as-is (default/catch-all queue behavior —
 * "unknown" just means Consus has no dedicated UI section for it yet, the
 * data is never dropped).
 */
export function ingestQuestion(db: Database.Database, question: Question): void {
  const itemId = itemIdFor(question.id);
  const now = new Date().toISOString();

  // Real decision-request/v1 shape (corrected against the documented spec
  // in mdostal/delphi's docs/decision-request-format.md): options A-Z with
  // tradeoffs, a required `recommended` letter. A Minerva yes/no Question
  // maps onto the minimal 2-option case; "recommended" defaults to "A"
  // (Yes) absent a stronger signal from Minerva's classifier — the real
  // spec requires every payload to take a position.
  const decisionPayload = JSON.stringify({
    version: "dostal:decision-request/v1",
    title: question.text,
    context: question.reason ?? "",
    options: [
      { id: "A", title: "Yes", tradeoffs: "" },
      { id: "B", title: "No", tradeoffs: "" },
    ],
    recommended: "A",
  });

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    ).run(itemId, "human_request", question.text, question.status, now, now, decisionPayload);

    db.prepare(
      `INSERT INTO human_requests (item_id, minerva_question_id, text, channel, reason, confidence, suggested_channel, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(minerva_question_id) DO UPDATE SET status = excluded.status`,
    ).run(
      itemId,
      question.id,
      question.text,
      question.channel,
      question.reason,
      question.confidence ?? null,
      question.suggestedChannel ?? null,
      question.status,
    );
  });
  tx();
}

export function getHumanRequest(db: Database.Database, minervaQuestionId: string): HumanRequestRow | undefined {
  return db
    .prepare("SELECT * FROM human_requests WHERE minerva_question_id = ?")
    .get(minervaQuestionId) as HumanRequestRow | undefined;
}

export interface AnswerHumanRequestInput {
  minervaQuestionId: string;
  answer: string;
}

/**
 * Answering a human_request in Consus writes the new status locally AND
 * calls back to Minerva so Question.status stays in sync in both
 * directions (REQ-01 acceptance criterion).
 */
export async function answerHumanRequest(
  db: Database.Database,
  transport: MinervaTransport,
  { minervaQuestionId, answer }: AnswerHumanRequestInput,
): Promise<void> {
  const existing = getHumanRequest(db, minervaQuestionId);
  if (!existing) {
    throw new Error(`human_request not found for Minerva question: ${minervaQuestionId}`);
  }

  db.prepare("UPDATE human_requests SET status = ? WHERE minerva_question_id = ?").run(
    "answered",
    minervaQuestionId,
  );
  db.prepare("UPDATE items SET status = ?, updated_at = ? WHERE id = ?").run(
    "answered",
    new Date().toISOString(),
    existing.item_id,
  );

  const result = await transport.invoke("answerQuestion", { id: minervaQuestionId, answer });
  if (!result.ok && !result.recoverable) {
    // Local state is already updated (Consus is the source of truth for the
    // operator's answer); a non-recoverable write-back failure is logged,
    // not thrown — REQ-01 requires status sync, but a Minerva-side outage
    // must not lose the operator's answer.
    // eslint-disable-next-line no-console
    console.error(`[minerva-adapter] status write-back failed for ${minervaQuestionId}: ${result.code}`);
  }
}
