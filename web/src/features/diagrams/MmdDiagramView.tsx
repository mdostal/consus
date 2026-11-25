import { useEffect, useState } from "react";
import { AuditPanel, type AuditTrailEntry } from "../audit/AuditPanel";
import type { ProposeChangeInput } from "../docs/DocRenderer";
import { computeLineDiff } from "../docs/textDiff";
import { MermaidDiagram } from "./MermaidDiagram";
import { MermaidEditor } from "./MermaidEditor";

export interface MmdDiagramViewProps {
  path: string;
  content: string;
  /** Omit for a read-only view (no Edit button). */
  onProposeChange?: (input: ProposeChangeInput) => void;
  pendingProposal?: boolean;
  proposalFailureReason?: string | null;
  auditEntries?: AuditTrailEntry[];
}

/**
 * PANT-965: a standalone `.mmd` diagram file — rendered, with an
 * "Edit diagram" action that opens the split source/preview editor. Saving
 * fires a proposal whose diff is a line diff of the whole file, the same
 * format DocRenderer's section edits send.
 */
export function MmdDiagramView({
  path,
  content,
  onProposeChange,
  pendingProposal,
  proposalFailureReason,
  auditEntries,
}: MmdDiagramViewProps) {
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [path, content]);

  return (
    <div className="mmd-diagram-view" data-testid="mmd-diagram-view">
      <div className="mmd-diagram-view__header">
        <h3 className="mmd-diagram-view__path">{path}</h3>
        {pendingProposal ? <span className="pill pill--pending">change proposed…</span> : null}
        {proposalFailureReason ? <span className="pill pill--failed">proposal failed: {proposalFailureReason}</span> : null}
        {onProposeChange && !editing ? (
          <button type="button" onClick={() => setEditing(true)}>
            Edit diagram
          </button>
        ) : null}
      </div>

      {editing && onProposeChange ? (
        <MermaidEditor
          initialSource={content}
          title={`Edit ${path}`}
          onCancel={() => setEditing(false)}
          onSave={({ source, description }) => {
            onProposeChange({ diff: computeLineDiff(content, source), description });
            setEditing(false);
          }}
        />
      ) : (
        <MermaidDiagram source={content} />
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
