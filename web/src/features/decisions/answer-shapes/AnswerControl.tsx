import { useState } from "react";
import type { DecisionPayload, FeatureSelectionPayload, Verdict } from "./types";
import { FeatureChecklist } from "./FeatureChecklist";

export interface AnswerControlProps {
  payload: DecisionPayload | FeatureSelectionPayload;
  onVerdict: (verdict: Verdict) => void;
}

/**
 * The real decision-request/v1 answer surface: options A-Z with tradeoffs
 * (recommended one marked), and the four verdicts a reviewer can render —
 * Accept (proceed with the recommended option), Option Chosen, Mix (several
 * options, why required), Reject — request iteration (commentary required).
 * Never a lone generic "Approve" button standing in for an actual decision.
 */
export function AnswerControl({ payload, onVerdict }: AnswerControlProps) {
  const [mixSelected, setMixSelected] = useState<string[]>([]);
  const [mixWhy, setMixWhy] = useState("");
  const [rejectCommentary, setRejectCommentary] = useState("");

  if (payload.version === "dostal:feature-selection/v1") {
    return <FeatureChecklist payload={payload} onVerdict={onVerdict} />;
  }

  function toggleMix(id: string) {
    setMixSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="answer-control">
      <ul className="answer-control__options">
        {payload.options.map((option) => (
          <li key={option.id} className="answer-control__option">
            {option.id === payload.recommended ? (
              <span data-testid="recommended-badge" className="answer-control__recommended">
                {option.id}
              </span>
            ) : (
              <span className="answer-control__option-id">{option.id}</span>
            )}
            <span className="answer-control__option-title">{option.title}</span>
            <span className="answer-control__option-tradeoffs">{option.tradeoffs}</span>
            {option.id !== payload.recommended ? (
              <button type="button" onClick={() => onVerdict({ kind: "option_chosen", optionId: option.id })}>
                Choose {option.title}
              </button>
            ) : null}
            <label>
              <input
                type="checkbox"
                aria-label={option.title}
                checked={mixSelected.includes(option.id)}
                onChange={() => toggleMix(option.id)}
              />
              Include in mix
            </label>
          </li>
        ))}
      </ul>

      <div className="answer-control__actions">
        <button type="button" onClick={() => onVerdict({ kind: "accepted" })}>
          Accept
        </button>

        <div className="answer-control__mix">
          <textarea
            aria-label="Why (mix rationale)"
            value={mixWhy}
            onChange={(e) => setMixWhy(e.target.value)}
          />
          <button
            type="button"
            disabled={mixSelected.length < 2 || !mixWhy.trim()}
            onClick={() => onVerdict({ kind: "mix", optionIds: mixSelected, why: mixWhy })}
          >
            Mix
          </button>
        </div>

        <div className="answer-control__reject">
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
