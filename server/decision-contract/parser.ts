/**
 * decision-request/v1 — the structured decision-object contract (REQ-11).
 *
 * RISK (flagged in architecture.md and epic.yaml): the real
 * `decision-request.ts` source lives only on the hive host
 * (ssh dostal@100.75.161.82 -> Claud-ometer/src/lib/consus/decision-request.ts)
 * and was not fetched during this implementation pass — fetching it and
 * reconciling this parser against the real source is a recommended
 * follow-up, not done here. This implementation is built from
 * docs/prior-art.md's documented shape: "pure, parses a fenced JSON block
 * from a ticket body," no external dependencies.
 */

export type AnswerShape = "yes_no" | "choose_one" | "survey" | "edit" | "approve";

export interface DecisionPayload {
  contractVersion: "decision-request/v1";
  answerShape: AnswerShape;
  question: string;
  reason?: string | null;
  choices?: string[];
  cbaTable?: Array<Record<string, string>>;
}

const FENCED_JSON_BLOCK = /```json\s*\n([\s\S]*?)\n```/;

/**
 * Parses a fenced ```json block out of arbitrary ticket-body prose, or a
 * bare JSON string. Returns null (never throws) when no valid
 * decision-request/v1 payload is found — callers treat this as "no
 * decision_payload," falling back to the generic item view.
 */
export function parseDecisionPayload(input: string): DecisionPayload | null {
  const fenced = FENCED_JSON_BLOCK.exec(input);
  const jsonText = fenced ? fenced[1] : input;

  try {
    const candidate = JSON.parse(jsonText) as Partial<DecisionPayload>;
    if (candidate.contractVersion !== "decision-request/v1" || !candidate.answerShape || !candidate.question) {
      return null;
    }
    return candidate as DecisionPayload;
  } catch {
    return null;
  }
}

export function serializeDecisionPayload(payload: DecisionPayload): string {
  return JSON.stringify(payload);
}

/**
 * Resolves which deterministic control should render for an item. Returns
 * null when the item has no decision_payload — additive, not a hard
 * requirement on every item (REQ-11 acceptance criterion).
 */
export function resolveAnswerShape(payload: DecisionPayload | null): AnswerShape | null {
  return payload?.answerShape ?? null;
}
