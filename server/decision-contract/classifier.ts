import type Database from "better-sqlite3";
import { parseDecisionPayload, type DecisionPayload } from "./parser.js";

/**
 * REQ-12: decision-type + triage-bucket classification. Generic and
 * contract-first — driven by decision_payload where present, never a
 * hardcoded per-item identifier allowlist (the prior build's REDO-flagged
 * mistake, per docs/prior-art.md).
 */

export type DecisionType = "cba" | "choose" | "survey" | "edit" | "quorum" | "doc" | "default";
export type TriageBucket = "open_question" | "your_action" | "agent_task" | "research_plan" | "noise";

export interface ClassificationResult {
  decisionType: DecisionType;
  triageBucket: TriageBucket;
}

interface ItemRow {
  id: string;
  type: string;
  decision_payload: string | null;
}

/** First-match-wins across the 7 decision-type renderer labels. */
function classifyDecisionType(payload: DecisionPayload | null): DecisionType {
  if (!payload) return "default";
  if (payload.cbaTable && payload.cbaTable.length > 0) return "cba";
  if (payload.answerShape === "choose_one") return "choose";
  if (payload.answerShape === "survey") return "survey";
  if (payload.answerShape === "edit") return "edit";
  if (payload.answerShape === "approve") return "doc";
  return "default";
}

function heuristicTriageBucket(item: ItemRow): TriageBucket {
  if (item.type === "human_request") return "open_question";
  // v1 heuristic default for other item types — no strong signal yet to
  // distinguish your_action/agent_task/noise without more item metadata.
  // Refinable once real Consus traffic exists; the override table is the
  // safety valve in the meantime (see this story's Risks).
  return "research_plan";
}

export function classifyItem(db: Database.Database, itemId: string): ClassificationResult {
  const item = db.prepare("SELECT id, type, decision_payload FROM items WHERE id = ?").get(itemId) as
    | ItemRow
    | undefined;
  if (!item) {
    throw new Error(`item not found: ${itemId}`);
  }

  const payload = item.decision_payload ? parseDecisionPayload(item.decision_payload) : null;
  const decisionType = classifyDecisionType(payload);

  const override = db.prepare("SELECT bucket FROM triage_overrides WHERE item_id = ?").get(itemId) as
    | { bucket: TriageBucket }
    | undefined;
  const triageBucket = override?.bucket ?? heuristicTriageBucket(item);

  db.prepare("UPDATE items SET decision_type = ?, triage_bucket = ? WHERE id = ?").run(
    decisionType,
    triageBucket,
    itemId,
  );

  return { decisionType, triageBucket };
}

export interface SetTriageOverrideInput {
  itemId: string;
  bucket: TriageBucket;
  author: string;
}

/** A human-authored override always beats the heuristic classifier. */
export function setTriageOverride(db: Database.Database, { itemId, bucket, author }: SetTriageOverrideInput): void {
  db.prepare(
    `INSERT INTO triage_overrides (item_id, bucket, author, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET bucket = excluded.bucket, author = excluded.author, created_at = excluded.created_at`,
  ).run(itemId, bucket, author, new Date().toISOString());
}
