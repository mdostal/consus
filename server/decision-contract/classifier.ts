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
  title: string;
  decision_payload: string | null;
}

/**
 * REQ-22: legacy heuristic fallback for items with no decision_payload at
 * all — ported from Claud-ometer's `review-queue.ts` `classifyDecisionType`
 * regexes (first-match-wins; exact patterns per
 * docs/delphi-lineage-inventory.md "Source 1"). Runs over the item title,
 * the only free-text field Consus's `items` table carries.
 */
const HEURISTIC_DECISION_TYPE_PATTERNS: ReadonlyArray<[DecisionType, RegExp]> = [
  ["cba", /\bcba\b|cost[\s-]?benefit|trade[\s-]?off|recommendation:|options considered/i],
  ["quorum", /\bquorum\b|tie[\s-]?break|tiebreak|\bsplit \d|votes? (for|against)|agents? (are )?split/i],
  ["choose", /\bchoose\b|1 of \d|pick (a|an|one|the)|which (option|approach|layout)|\boption \d|\bmockups?\b/i],
  ["survey", /\bsurvey\b|multi[\s-]?select|select (features|all that|the features)|checklist|pick (any|many)/i],
  [
    "edit",
    /\breport\b|amend|proofread|edit\b|\bdiff\b|redline|weekly (ops|swarm|report)|review (&|and) (amend|edit)/i,
  ],
];

function classifyDecisionTypeHeuristic(title: string): DecisionType {
  for (const [type, pattern] of HEURISTIC_DECISION_TYPE_PATTERNS) {
    if (pattern.test(title)) return type;
  }
  return "default";
}

/**
 * First-match-wins across the 7 decision-type renderer labels. CORRECTED:
 * the real decision-request/v1 payload (see parser.ts) is always an
 * options[] (A-Z) + recommended shape — there is no per-payload
 * answerShape/cbaTable field to switch on. A payload with `diagram: true`
 * classifies as "cba" (the real spec's own field-reference table notes
 * `diagram` is set "if the doc body contains an architecture diagram,"
 * which is the CBA-with-diagram case); any other valid payload is "choose".
 * Items with no decision_payload fall through to the REQ-22 heuristic
 * above instead of a bare "default". "doc" remains unreachable by either
 * path — the lineage doc's regex list never produces it.
 */
function classifyDecisionType(payload: DecisionPayload | null, title: string): DecisionType {
  if (payload) {
    if (payload.diagram === true) return "cba";
    return "choose";
  }
  return classifyDecisionTypeHeuristic(title);
}

/**
 * REQ-22: v1 had no fallback for items without a decision_payload — every
 * such item defaulted to triageBucket "research_plan". Claud-ometer's
 * `classifyBucket` defaults instead to "agent_task" (a real bug fix, per
 * the lineage doc), and also promotes a decision-shaped title (matched by
 * the same heuristic regexes above — "title matches DECISION_TITLE_RE" in
 * the lineage doc's ordering) to "open_question".
 *
 * Not ported: the lineage doc's curated-DECIDE-line and hardcoded
 * KNOWN_HUMAN_IDENTIFIERS tiers (the latter explicitly REDO-flagged as a
 * hardcoding mistake not to repeat), and its NOISE_RE/RESEARCH_RE/AGENT_RE
 * — Source 1 notes those weren't fetched in full, only named, so there is
 * no literal pattern to port yet. "noise"/"research_plan" stay reachable
 * only via a human triage_overrides row until that source exists.
 *
 * s1-heuristic-extraction-tier-confidence: a tier-2 (extractionTier ===
 * "heuristic") decision is a regex guess extracted out of free-form prose,
 * not a deliberately structured decision-request — route it to
 * "agent_task" instead of "open_question" so an agent pass can confirm/
 * correct the guess before it's surfaced to a human as settled. The tier-1
 * (structured, extractionTier unset) path is unchanged.
 */
function heuristicTriageBucket(
  item: ItemRow,
  decisionType: DecisionType,
  payload: DecisionPayload | null,
): TriageBucket {
  if (item.type === "human_request") return "open_question";
  if (decisionType !== "default") {
    return payload?.extractionTier === "heuristic" ? "agent_task" : "open_question";
  }
  return "agent_task";
}

export function classifyItem(db: Database.Database, itemId: string): ClassificationResult {
  const item = db.prepare("SELECT id, type, title, decision_payload FROM items WHERE id = ?").get(itemId) as
    | ItemRow
    | undefined;
  if (!item) {
    throw new Error(`item not found: ${itemId}`);
  }

  const payload = item.decision_payload ? parseDecisionPayload(item.decision_payload) : null;
  const decisionType = classifyDecisionType(payload, item.title);

  const override = db.prepare("SELECT bucket FROM triage_overrides WHERE item_id = ?").get(itemId) as
    | { bucket: TriageBucket }
    | undefined;
  const triageBucket = override?.bucket ?? heuristicTriageBucket(item, decisionType, payload);

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
