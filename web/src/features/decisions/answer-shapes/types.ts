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

export type Verdict =
  | { kind: "accepted" }
  | { kind: "option_chosen"; optionId: string }
  | { kind: "mix"; optionIds: string[]; why: string }
  | { kind: "rejected_iteration_requested"; commentary: string }
  | { kind: "features_selected"; selected: string[] };
