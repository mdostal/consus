import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { AuditPanel, type AuditTrailEntry } from "../audit/AuditPanel";
import { computeLineDiff } from "./textDiff";
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
 * between the original `content` and the edited draft (see ./textDiff) and
 * calls onProposeChange({ diff, description }) — the same contract the old
 * hand-typed-diff form used, unchanged. The operator never types a diff by
 * hand. Firing (like Cancel) returns to view mode; the pendingProposal /
 * proposalFailureReason pills above the content are unaffected by this
 * story and keep working exactly as before.
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
  const [description, setDescription] = useState("");

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState(content);

  // p8-01: a different doc opening (content prop changing) always discards
  // any in-progress edit and returns to view mode — no draft survives a
  // navigation.
  useEffect(() => {
    setMode("view");
    setDraft(content);
    setDescription("");
  }, [content]);

  const hasChanges = draft !== content;

  const fire = () => {
    if (!hasChanges || !description.trim() || !onProposeChange) return;
    onProposeChange({ diff: computeLineDiff(content, draft), description: description.trim() });
    setDescription("");
    setMode("view");
  };

  const cancelEdit = () => {
    setDraft(content);
    setDescription("");
    setMode("view");
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

      {content && mode === "view" ? (
        <div className="doc-renderer__edit-header">
          <button type="button" onClick={() => setMode("edit")}>
            Edit
          </button>
        </div>
      ) : null}

      {mode === "edit" ? (
        <div className="doc-renderer__edit-form">
          <textarea
            data-testid="doc-edit-textarea"
            aria-label="Edit doc content"
            className="doc-renderer__edit-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {onProposeChange ? (
            <label>
              Description
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. removed load balancers for direct traffic through..."
              />
            </label>
          ) : null}
          <div className="doc-renderer__edit-actions">
            <button type="button" onClick={cancelEdit}>
              Cancel
            </button>
            {onProposeChange ? (
              <button type="button" onClick={fire} disabled={!hasChanges || !description.trim()}>
                Fire to harness
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div data-testid="doc-html" className="doc-renderer" dangerouslySetInnerHTML={{ __html: html }} />
      )}

      {auditEntries ? (
        <div className="doc-renderer__history">
          <h4>History</h4>
          <AuditPanel entries={auditEntries} />
        </div>
      ) : null}
    </div>
  );
}
