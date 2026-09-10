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
  /** Letter of the agent's recommended default — required, never omitted. */
  recommended: string;
  diagram?: boolean;
  doc?: DecisionDocPointer;
  research?: ResearchSection[];
  /**
   * Set to "heuristic" by parseHeuristicPayload (tier 2); left unset
   * (undefined) on the tier-1 structured path — undefined is the implicit
   * "structured" default, which keeps every existing tier-1 assertion
   * (including exact-shape .toEqual checks) unchanged. See s1-heuristic-
   * extraction-tier-confidence.
   */
  extractionTier?: "structured" | "heuristic";
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
 * dostal:edit-proposal/v1 (s4-edit-and-cba-answer-shapes) — defined from
 * scratch this story, a renderer-only type routed to by the classifier's
 * pre-existing "edit" title-regex label (docs/prior-art.md's "Inline
 * green-add/red-strike line-diff editor"). `original`/`proposed` are plain
 * text; the renderer computes the line diff itself (no precomputed diff
 * shipped in the payload) rather than trusting a caller-supplied diff blob.
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
 * schema: a structured comparison table only, deliberately NOT a
 * cost-benefit computation/recommendation engine (no scoring/weighting
 * fields). No upstream producer exists yet; this story defines the schema
 * from scratch, same as feature-selection/v1 did.
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

/**
 * dostal:free-text/v1 (s5-freetext-rating-ranking-answer-shapes) — an
 * open-ended free-text response. Deliberately just a prompt string; no
 * upstream producer exists yet, same "defined from scratch" precedent as
 * feature-selection/v1 and edit-proposal/v1.
 */
export interface FreeTextPayload {
  version: "dostal:free-text/v1";
  title: string;
  context: string;
  prompt: string;
  research?: ResearchSection[];
}

/**
 * dostal:rating/v1 (s5-freetext-rating-ranking-answer-shapes) — a
 * numeric/star rating scale. `labels` optionally maps individual scale
 * values (as object keys, since JSON has no numeric-keyed maps) to a
 * human-readable label, e.g. `{ 1: "Poor", 5: "Excellent" }`.
 */
export interface RatingScaleConfig {
  min: number;
  max: number;
  labels?: Record<number, string>;
}

export interface RatingPayload {
  version: "dostal:rating/v1";
  title: string;
  context: string;
  prompt: string;
  scale: RatingScaleConfig;
  research?: ResearchSection[];
}

/**
 * dostal:ranking/v1 (s5-freetext-rating-ranking-answer-shapes) — a
 * drag-to-reorder ranking of a fixed item list. The verdict records the
 * item ids in the user's chosen order, not a per-item rank number.
 */
export interface RankingItem {
  id: string;
  label: string;
}

export interface RankingPayload {
  version: "dostal:ranking/v1";
  title: string;
  context: string;
  prompt: string;
  items: RankingItem[];
  research?: ResearchSection[];
}

/**
 * dostal:concept-selection/v1 (s2-concept-selection-answer-shape) —
 * deliberately generalized ("pick one of N named options, each with a
 * visual preview"), not logo-specific, so any future design decision of
 * this shape (not just logo concepts) reuses this payload type instead of
 * a new one being defined. `preview` is a discriminated union on `kind` so
 * a future "image" variant (reusing the phase28 GET /api/design-assets
 * pattern) is additive, not a breaking change to this shape.
 *
 * SECURITY: `preview.markup` is raw SVG markup rendered via
 * dangerouslySetInnerHTML by the ConceptSelection renderer. It must only
 * ever come from server/operator-authored content (e.g. a manifest an
 * agent or operator writes) — never from end-user input — the same
 * injection-surface posture noted in this story's design discussion.
 */
export interface ConceptSvgPreview {
  kind: "svg";
  markup: string;
}

export type ConceptPreview = ConceptSvgPreview;

export interface Concept {
  id: string;
  name: string;
  description: string;
  preview: ConceptPreview;
}

export interface ConceptSelectionPayload {
  version: "dostal:concept-selection/v1";
  title: string;
  context: string;
  concepts: Concept[];
  research?: ResearchSection[];
}

export type Verdict =
  | { kind: "accepted" }
  | { kind: "option_chosen"; optionId: string }
  | { kind: "mix"; optionIds: string[]; why: string }
  | { kind: "rejected_iteration_requested"; commentary: string }
  | { kind: "features_selected"; selected: string[] }
  | { kind: "text_response"; text: string }
  | { kind: "rated"; value: number }
  | { kind: "ranked"; order: string[] }
  | { kind: "concept_selected"; conceptId: string };

/** Maps a verdict to the ticket status transition (accept/choose/mix/features_selected/text_response/rated/ranked -> done, reject -> in_progress). */
export function verdictStatus(verdict: Verdict): "done" | "in_progress" {
  return verdict.kind === "rejected_iteration_requested" ? "in_progress" : "done";
}

/** Human-readable summary of a verdict for audit-log comments. */
export function verdictSummary(verdict: Verdict): string {
  switch (verdict.kind) {
    case "accepted":
      return "Accepted the recommended option.";
    case "option_chosen":
      return `Chose option ${verdict.optionId}.`;
    case "mix":
      return `Mixed options ${verdict.optionIds.join(" + ")} — ${verdict.why}`;
    case "rejected_iteration_requested":
      return `Requested another round — ${verdict.commentary}`;
    case "features_selected":
      return `Selected features: ${verdict.selected.join(", ")}`;
    case "text_response":
      return `Responded: ${verdict.text}`;
    case "rated":
      return `Rated ${verdict.value}.`;
    case "ranked":
      return `Ranked: ${verdict.order.join(" > ")}`;
    case "concept_selected":
      return `Selected concept ${verdict.conceptId}.`;
  }
}

const FENCED_DECISION_REQUEST_BLOCK = /```decision-request\s*\n([\s\S]*?)\n```/;

/**
 * Tier 2 — heuristic-from-markdown fallback (REQ-23, ported from
 * mdostal/delphi's server/parse.mjs). When a ticket isn't the structured
 * ```decision-request block (tier 1), extract options from free-form
 * markdown prose before giving up (tier 3 — none). Three option shapes are
 * tried in order, first one to yield 2+ options wins:
 *   - `#### Option A — title` / `Option A: title` headings
 *   - `A) TITLE: detail` lines
 *   - `**A — title**` comparison-table cells
 * `recommended` is resolved from the first line matching /recommend/i that
 * names one of the extracted option letters. If no such line exists, the
 * heuristic tier has nothing to recommend and falls through to tier 3 —
 * "agents must always take a position" is a contract invariant, not a
 * tier-1-only rule.
 */
// Option ids are always a single capital letter (see DecisionOption.id) — matching only
// uppercase here (rather than [A-Za-z]) avoids treating lowercase lettered checklists
// ("a) Configure timeout: 30s") elsewhere in the ticket body as decision options.
// [Oo]ption (not the `i` flag) so "option"/"Option" both match without
// making the captured letter group case-insensitive too.
const OPTION_HEADING = /^#{0,6}\s*[Oo]ption\s+([A-Z])\s*[—–:-]\s*(.+)$/gm;
const OPTION_LETTER_LINE = /^([A-Z])\)\s*([^:\n]+):\s*(.+)$/gm;
const OPTION_TABLE_CELL = /\*\*([A-Z])\s*[—–-]\s*([^*\n]+)\*\*/g;

function extractHeuristicOptions(
  input: string,
): { options: DecisionOption[]; firstIndex: number } | null {
  for (const pattern of [OPTION_HEADING, OPTION_LETTER_LINE, OPTION_TABLE_CELL]) {
    const seen = new Map<string, DecisionOption>();
    let firstIndex = -1;
    for (const match of input.matchAll(pattern)) {
      if (firstIndex === -1) firstIndex = match.index ?? 0;
      const id = match[1].toUpperCase();
      if (seen.has(id)) continue;
      seen.set(id, { id, title: match[2].trim(), tradeoffs: (match[3] ?? "").trim() });
    }
    if (seen.size >= 2) {
      return { options: [...seen.values()].sort((a, b) => a.id.localeCompare(b.id)), firstIndex };
    }
  }
  return null;
}

function extractRecommended(input: string, optionIds: string[]): string | null {
  for (const line of input.split("\n")) {
    const keyword = /recommend/i.exec(line);
    if (!keyword) continue;

    // Pick the option letter closest to the "recommend" keyword, not just the
    // leftmost one in the line — "we compared A and B but recommend B" must
    // resolve to B, not A.
    let best: { id: string; distance: number } | null = null;
    for (const id of optionIds) {
      for (const match of line.matchAll(new RegExp(`\\b${id}\\b`, "g"))) {
        const distance = Math.abs((match.index ?? 0) - keyword.index);
        if (!best || distance < best.distance) {
          best = { id, distance };
        }
      }
    }
    if (best) return best.id;
  }
  return null;
}

function extractTitle(input: string): string {
  for (const line of input.split("\n")) {
    const trimmed = line.replace(/^#+\s*/, "").trim();
    if (trimmed) return trimmed;
  }
  return "Untitled decision";
}

function extractContext(input: string, firstOptionIndex: number, title: string): string {
  const lead = input
    .slice(0, firstOptionIndex)
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line && line !== title)
    .join(" ")
    .trim();
  return lead || title;
}

function parseHeuristicPayload(input: string): DecisionPayload | null {
  const extracted = extractHeuristicOptions(input);
  if (!extracted) return null;

  const recommended = extractRecommended(
    input,
    extracted.options.map((option) => option.id),
  );
  if (!recommended) return null;

  const title = extractTitle(input);
  return {
    version: "dostal:decision-request/v1",
    title,
    context: extractContext(input, extracted.firstIndex, title),
    options: extracted.options,
    recommended,
    extractionTier: "heuristic",
  };
}

/**
 * Parses a fenced ```decision-request block out of arbitrary ticket-body
 * prose, or a bare JSON string (tier 1 — structured). Falls back to
 * regex-extracted options from free-form markdown (tier 2 — heuristic, see
 * parseHeuristicPayload) before giving up. Returns null (never throws) only
 * when neither tier finds a valid decision-request/v1 payload — callers
 * treat this as "no decision_payload," falling back to the generic item
 * view or the legacy heuristic classifier (decision-taxonomy-and-triage).
 */
export function parseDecisionPayload(input: string): DecisionPayload | null {
  const fenced = FENCED_DECISION_REQUEST_BLOCK.exec(input);
  const jsonText = fenced ? fenced[1] : input;

  try {
    const candidate = JSON.parse(jsonText) as Partial<DecisionPayload>;
    if (
      candidate.version === "dostal:decision-request/v1" &&
      candidate.title &&
      candidate.options &&
      candidate.options.length >= 2 &&
      candidate.recommended
    ) {
      return candidate as DecisionPayload;
    }
  } catch {
    // Not a bare JSON / fenced-JSON payload — fall through to the heuristic tier.
  }

  return parseHeuristicPayload(input);
}

export function serializeDecisionPayload(payload: DecisionPayload): string {
  return JSON.stringify(payload);
}

