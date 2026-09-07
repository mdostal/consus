import { useMemo, useState } from "react";
import type { EditProposalPayload, Verdict } from "./types";
import { computeEditDiffLines } from "./editDiff";

export interface EditProposalViewProps {
  payload: EditProposalPayload;
  onVerdict: (verdict: Verdict) => void;
}

/**
 * dostal:edit-proposal/v1 renderer — a diff-styled proposed-change view
 * (green add / red remove, unchanged lines as context), with accept/reject
 * verdict actions. Reuses the same "accepted" / "rejected_iteration_requested"
 * verdict kinds every other answer-shape uses — no edit-specific verdict kind
 * was needed.
 *
 * s2-rendered-visual-diff integration point (design_decisions in this
 * story's spec): if/when a shared VisualDiff component lands, this component
 * should swap its line-rendering for it. Until then it renders directly
 * against computeEditDiffLines's raw output.
 */
export function EditProposalView({ payload, onVerdict }: EditProposalViewProps) {
  const [rejectCommentary, setRejectCommentary] = useState("");
  const lines = useMemo(
    () => computeEditDiffLines(payload.original, payload.proposed),
    [payload.original, payload.proposed],
  );

  return (
    <div className="edit-proposal-view">
      <p className="edit-proposal-view__context">{payload.context}</p>

      <ul className="edit-proposal-view__diff" data-testid="edit-proposal-diff" aria-label="Proposed change diff">
        {lines.map((line, index) => (
          <li
            key={index}
            className={`edit-proposal-view__line edit-proposal-view__line--${line.kind}`}
            data-diff-kind={line.kind}
          >
            <span className="edit-proposal-view__line-marker" aria-hidden="true">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
            </span>
            <span className="edit-proposal-view__line-text">{line.text}</span>
          </li>
        ))}
      </ul>

      <div className="edit-proposal-view__actions">
        <button type="button" onClick={() => onVerdict({ kind: "accepted" })}>
          Accept
        </button>

        <div className="edit-proposal-view__reject">
          <textarea
            aria-label="Commentary (reject/iterate)"
            value={rejectCommentary}
            onChange={(e) => setRejectCommentary(e.target.value)}
          />
          <button
            type="button"
            disabled={!rejectCommentary.trim()}
            onClick={() => onVerdict({ kind: "rejected_iteration_requested", commentary: rejectCommentary })}
          >
            Reject — request iteration
          </button>
        </div>
      </div>
    </div>
  );
}
