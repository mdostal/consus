/**
 * CORRECTED against the real dostal:decision-request/v1 spec (found in the
 * pre-existing mdostal/delphi repo's docs/decision-request-format.md) —
 * options A-Z with tradeoffs, a required `recommended` letter.
 */

export interface DecisionOption {
  id: string;
  title: string;
  tradeoffs: string;
}

export interface DecisionDocPointer {
  repo: string;
  path: string;
  ref?: string;
}

export interface ResearchSection {
  title: string;
  body: string;
  sources?: string[];
}

export interface DecisionPayload {
  version: "dostal:decision-request/v1";
  title: string;
  context: string;
  options: DecisionOption[];
  recommended: string;
  diagram?: boolean;
  doc?: DecisionDocPointer;
  research?: ResearchSection[];
}

export interface FeatureOption {
  id: string;
  name: string;
  description: string;
  default?: boolean;
}

export interface FeatureSelectionPayload {
  version: "dostal:feature-selection/v1";
  title: string;
  context: string;
  features: FeatureOption[];
  research?: ResearchSection[];
}

/**
 * dostal:edit-proposal/v1 (s4-edit-and-cba-answer-shapes) — a diff-styled
 * proposed-change view. `original`/`proposed` are plain text; the renderer
 * computes the line diff itself rather than trusting a caller-supplied diff
 * blob.
 */
export interface EditProposalPayload {
  version: "dostal:edit-proposal/v1";
  title: string;
  context: string;
  original: string;
  proposed: string;
  research?: ResearchSection[];
}

/**
 * dostal:cba/v1 (s4-edit-and-cba-answer-shapes) — user-confirmed minimal
 * schema, rendered as a structured comparison table only (NOT a
 * computation/recommendation engine).
 */
export interface CbaOption {
  option: string;
  cost: string;
  benefit: string;
  notes?: string;
}

export interface CbaPayload {
  version: "dostal:cba/v1";
  title: string;
  context: string;
  options: CbaOption[];
  research?: ResearchSection[];
}

export type Verdict =
  | { kind: "accepted" }
  | { kind: "option_chosen"; optionId: string }
  | { kind: "mix"; optionIds: string[]; why: string }
  | { kind: "rejected_iteration_requested"; commentary: string }
  | { kind: "features_selected"; selected: string[] };
