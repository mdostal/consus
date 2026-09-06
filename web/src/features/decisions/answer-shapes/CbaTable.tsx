import { useState } from "react";
import type { CbaPayload, Verdict } from "./types";

export interface CbaTableProps {
  payload: CbaPayload;
  onVerdict: (verdict: Verdict) => void;
}

/**
 * dostal:cba/v1 renderer — a structured cost/benefit comparison table, one
 * row per option (option/cost/benefit/notes columns). Deliberately just a
 * table: no scoring, weighting, or "recommended option" computation — see
 * this story's risk note ("cba renderer scope-creeps into an actual
 * cost-benefit computation/recommendation engine"). Accept/reject reuse the
 * same generic verdict kinds every other answer-shape uses.
 */
export function CbaTable({ payload, onVerdict }: CbaTableProps) {
  const [rejectCommentary, setRejectCommentary] = useState("");

  return (
    <div className="cba-table">
      <p className="cba-table__context">{payload.context}</p>

      <table className="cba-table__grid" aria-label="Cost/benefit comparison">
        <thead>
          <tr>
            <th scope="col">Option</th>
            <th scope="col">Cost</th>
            <th scope="col">Benefit</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {payload.options.map((option, index) => (
            <tr key={`${option.option}-${index}`} className="cba-table__row">
              <td className="cba-table__option">{option.option}</td>
              <td className="cba-table__cost">{option.cost}</td>
              <td className="cba-table__benefit">{option.benefit}</td>
              <td className="cba-table__notes">{option.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="cba-table__actions">
        <button type="button" onClick={() => onVerdict({ kind: "accepted" })}>
          Accept
        </button>

        <div className="cba-table__reject">
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
