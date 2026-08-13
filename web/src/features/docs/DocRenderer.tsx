import { useMemo, useState } from "react";
import { marked } from "marked";
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
}

/**
 * REQ-03: renders a doc as formatted content — never raw markup. Uses the
 * shared DecisionCard theme tokens (scoped-scroll container, per REQ-15)
 * for wide tables/diagrams inside rendered docs.
 *
 * s5: optional propose-a-change mode, sharing the same UI shape as
 * DiagramView's (s4) — compose a diff + description, fire it through s3's
 * dispatch mechanism. Consus never writes to the doc's source directly;
 * the `content` prop is only ever set by the caller re-fetching after a
 * harness reports an applied result.
 */
export function DocRenderer({
  format,
  content,
  onProposeChange,
  pendingProposal,
  proposalFailureReason,
}: DocRendererProps) {
  const html = useMemo(() => (format === "md" ? (marked.parse(content, { async: false }) as string) : content), [
    format,
    content,
  ]);
  const [composing, setComposing] = useState(false);
  const [diff, setDiff] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!diff.trim() || !description.trim() || !onProposeChange) return;
    onProposeChange({ diff: diff.trim(), description: description.trim() });
    setDiff("");
    setDescription("");
    setComposing(false);
  };

  return (
    <div className="doc-renderer-wrap">
      {onProposeChange ? (
        <div className="doc-renderer__propose-header">
          {pendingProposal ? <span className="pill pill--pending">change proposed…</span> : null}
          {proposalFailureReason ? (
            <span className="pill pill--failed">proposal failed: {proposalFailureReason}</span>
          ) : null}
          <button type="button" onClick={() => setComposing((c) => !c)}>
            {composing ? "Cancel" : "Propose a change"}
          </button>
        </div>
      ) : null}

      {composing ? (
        <div className="doc-renderer__propose-form">
          <label>
            Description
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. removed load balancers for direct traffic through..."
            />
          </label>
          <label>
            Diff
            <textarea value={diff} onChange={(e) => setDiff(e.target.value)} placeholder="+ added X&#10;- removed Y" />
          </label>
          <button type="button" onClick={submit} disabled={!diff.trim() || !description.trim()}>
            Fire to harness
          </button>
        </div>
      ) : null}

      <div data-testid="doc-html" className="doc-renderer" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
