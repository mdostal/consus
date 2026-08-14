import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { AuditPanel, type AuditTrailEntry } from "../audit/AuditPanel";
import { computeLineDiff } from "./textDiff";
import { splitIntoSections } from "./sections";
import "../../theme/tokens.css";

export interface ProposeChangeInput {
  diff: string;
  description: string;
}

export interface DocRendererProps {
  format: "md" | "html";
  content: string;
  /** kb-01/s5: propose-a-change mode. Omit to keep the plain render-only view. */
  onProposeChange?: (input: ProposeChangeInput) => void;
  pendingProposal?: boolean;
  proposalFailureReason?: string | null;
  /** s5: history for this doc's item (audit_log + proposals), via the
   *  shared AuditPanel. Omit to keep the panel hidden. */
  auditEntries?: AuditTrailEntry[];
}

interface SectionState {
  mode: "view" | "edit";
  draft: string;
  description: string;
}

function initialSectionState(section: string): SectionState {
  return { mode: "view", draft: section, description: "" };
}

/**
 * REQ-03: renders a doc as formatted content — never raw markup. Uses the
 * shared DecisionCard theme tokens (scoped-scroll container, per REQ-15)
 * for wide tables/diagrams inside rendered docs.
 *
 * p8-01: an in-place view/edit toggle. An Edit button (shown once content
 * has loaded, in view mode) swaps the rendered content for a textarea
 * seeded with the current content; Cancel discards the in-progress edit
 * and reverts to view mode.
 *
 * p8-02: the propose-a-change flow is now driven by that edit mode instead
 * of a separate always-visible raw-diff form. While editing, a description
 * input sits alongside the textarea; "Fire to harness" computes a diff
 * between the original content and the edited draft (see ./textDiff) and
 * calls onProposeChange({ diff, description }) — the same contract the old
 * hand-typed-diff form used, unchanged. The operator never types a diff by
 * hand. Firing (like Cancel) returns to view mode; the pendingProposal /
 * proposalFailureReason pills above the content are unaffected by this
 * story and keep working exactly as before.
 *
 * p12-01 (sectional-edit-state): the single doc-wide mode/draft/description
 * trio above has been replaced with an array of per-section state, one
 * entry per splitIntoSections(content) result. Each section gets its own
 * independent Edit/Cancel/Fire controls; editing or firing one section
 * never touches any other section's in-progress edit. The view-mode
 * rendering below is unchanged — it still runs marked.parse over the full
 * joined `content` string, exactly as before this story.
 */
export function DocRenderer({
  format,
  content,
  onProposeChange,
  pendingProposal,
  proposalFailureReason,
  auditEntries,
}: DocRendererProps) {
  const html = useMemo(() => (format === "md" ? (marked.parse(content, { async: false }) as string) : content), [
    format,
    content,
  ]);

  const sections = useMemo(() => splitIntoSections(content), [content]);
  const [sectionStates, setSectionStates] = useState<SectionState[]>(() => sections.map(initialSectionState));

  // p8-01/p12-01: a different doc opening (content prop changing) always
  // discards any in-progress edit on every section and returns all sections
  // to view mode — no draft survives a navigation.
  useEffect(() => {
    setSectionStates(splitIntoSections(content).map(initialSectionState));
  }, [content]);

  const setSectionState = (index: number, update: Partial<SectionState>) => {
    setSectionStates((prev) => prev.map((state, i) => (i === index ? { ...state, ...update } : state)));
  };

  const fire = (index: number) => {
    const section = sections[index];
    const state = sectionStates[index];
    if (!state) return;
    const hasChanges = state.draft !== section;
    if (!hasChanges || !state.description.trim() || !onProposeChange) return;
    onProposeChange({ diff: computeLineDiff(section, state.draft), description: state.description.trim() });
    setSectionState(index, { mode: "view", draft: section, description: "" });
  };

  const cancelEdit = (index: number) => {
    const section = sections[index];
    setSectionState(index, { mode: "view", draft: section, description: "" });
  };

  return (
    <div className="doc-renderer-wrap">
      {onProposeChange ? (
        <div className="doc-renderer__propose-header">
          {pendingProposal ? <span className="pill pill--pending">change proposed…</span> : null}
          {proposalFailureReason ? (
            <span className="pill pill--failed">proposal failed: {proposalFailureReason}</span>
          ) : null}
        </div>
      ) : null}

      {content ? (
        sections.map((section, index) => {
          const state = sectionStates[index];
          if (!state) return null;
          const hasChanges = state.draft !== section;

          return (
            <div className="doc-renderer__section" key={index} data-testid={`doc-section-${index}`}>
              {state.mode === "view" ? (
                onProposeChange ? (
                  <div className="doc-renderer__edit-header">
                    <button type="button" onClick={() => setSectionState(index, { mode: "edit" })}>
                      Edit
                    </button>
                  </div>
                ) : null
              ) : (
                <div className="doc-renderer__edit-form">
                  <textarea
                    data-testid={`doc-edit-textarea-${index}`}
                    aria-label={`Edit section ${index + 1} content`}
                    className="doc-renderer__edit-textarea"
                    value={state.draft}
                    onChange={(e) => setSectionState(index, { draft: e.target.value })}
                  />
                  {onProposeChange ? (
                    <label>
                      Description
                      <input
                        type="text"
                        value={state.description}
                        onChange={(e) => setSectionState(index, { description: e.target.value })}
                        placeholder="e.g. removed load balancers for direct traffic through..."
                      />
                    </label>
                  ) : null}
                  <div className="doc-renderer__edit-actions">
                    <button type="button" onClick={() => cancelEdit(index)}>
                      Cancel
                    </button>
                    {onProposeChange ? (
                      <button
                        type="button"
                        onClick={() => fire(index)}
                        disabled={!hasChanges || !state.description.trim()}
                      >
                        Fire to harness
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })
      ) : null}

      {sectionStates.every((state) => state.mode === "view") ? (
        <div data-testid="doc-html" className="doc-renderer" dangerouslySetInnerHTML={{ __html: html }} />
      ) : null}

      {auditEntries ? (
        <div className="doc-renderer__history">
          <h4>History</h4>
          <AuditPanel entries={auditEntries} />
        </div>
      ) : null}
    </div>
  );
}
