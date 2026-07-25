/**
 * decision-request/v1 — the structured decision-object contract (REQ-11).
 *
 * CORRECTED against the real spec, found in the pre-existing mdostal/delphi
 * repo's docs/decision-request-format.md (`dostal:decision-request/v1`) —
 * the actual documented contract, not the approximate shape this file
 * originally guessed at from docs/prior-art.md's summary. Real shape:
 * fenced ```decision-request block, options A-Z with tradeoffs, a required
 * `recommended` letter ("agents must always take a position"), an optional
 * `doc` live-git pointer.
 */

export interface DecisionOption {
  /** Single capital letter A-Z, in order. */
  id: string;
  title: string;
  tradeoffs: string;
}

export interface DecisionDocPointer {
  repo: string;
  path: string;
  ref?: string;
}

export interface DecisionPayload {
  version: "dostal:decision-request/v1";
  title: string;
  context: string;
  options: DecisionOption[];
  /** Letter of the agent's recommended default — required, never omitted. */
  recommended: string;
  diagram?: boolean;
  doc?: DecisionDocPointer;
}

export type Verdict =
  | { kind: "accepted" }
  | { kind: "option_chosen"; optionId: string }
  | { kind: "mix"; optionIds: string[]; why: string }
  | { kind: "rejected_iteration_requested"; commentary: string };

/** Maps a verdict to the ticket status transition (accept/choose/mix -> done, reject -> in_progress). */
export function verdictStatus(verdict: Verdict): "done" | "in_progress" {
  return verdict.kind === "rejected_iteration_requested" ? "in_progress" : "done";
}

const FENCED_DECISION_REQUEST_BLOCK = /```decision-request\s*\n([\s\S]*?)\n```/;

/**
 * Parses a fenced ```decision-request block out of arbitrary ticket-body
 * prose, or a bare JSON string. Returns null (never throws) when no valid
 * decision-request/v1 payload is found — callers treat this as "no
 * decision_payload," falling back to the generic item view or the legacy
 * heuristic classifier (decision-taxonomy-and-triage).
 */
export function parseDecisionPayload(input: string): DecisionPayload | null {
  const fenced = FENCED_DECISION_REQUEST_BLOCK.exec(input);
  const jsonText = fenced ? fenced[1] : input;

  try {
    const candidate = JSON.parse(jsonText) as Partial<DecisionPayload>;
    if (
      candidate.version !== "dostal:decision-request/v1" ||
      !candidate.title ||
      !candidate.options ||
      candidate.options.length < 2 ||
      !candidate.recommended
    ) {
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
