import { API_BASE_URL } from "../config";
import type { DecisionPayload } from "../features/decisions/answer-shapes/types";
import type { DecisionType, TriageBucket } from "../../../server/decision-contract/classifier";

export interface DecisionListItem {
  id: string;
  type: string;
  title: string;
  status: string;
  decision_payload: DecisionPayload | null;
  decision_type: DecisionType | null;
  triage_bucket: TriageBucket | null;
  /** raw source text (issue body, doc, etc.) — present on the wire but only
   *  worth rendering in the detail panel, not the list rows. */
  source_body?: string | null;
}

export interface FetchDecisionsOptions {
  /** include already-decided items (GET /api/decisions?all=1) */
  includeDecided?: boolean;
}

/**
 * [frontend-api-integration]: fetches the live decision queue from
 * GET /api/decisions (see server/routes/decisions.ts) — a bare JSON array,
 * not `{ decisions: [...] }`.
 */
export async function fetchDecisions(opts: FetchDecisionsOptions = {}): Promise<DecisionListItem[]> {
  const url = `${API_BASE_URL}/api/decisions${opts.includeDecided ? "?all=1" : ""}`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`Failed to load decisions: ${detail}`);
  }

  return response.json();
}
