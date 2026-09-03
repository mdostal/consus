import { useState } from "react";
import type { FeatureSelectionPayload, Verdict } from "./types";

export interface FeatureChecklistProps {
  payload: FeatureSelectionPayload;
  onVerdict: (verdict: Verdict) => void;
}

export function FeatureChecklist({ payload, onVerdict }: FeatureChecklistProps) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(payload.features.filter((f) => f.default).map((f) => f.id))
  );
  const [rejectCommentary, setRejectCommentary] = useState("");

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="answer-control">
      <ul className="answer-control__features">
        {payload.features.map((feature) => (
          <li key={feature.id} className="answer-control__feature">
            <label>
              <input
                type="checkbox"
                aria-label={feature.name}
                checked={checked.has(feature.id)}
                onChange={() => toggle(feature.id)}
              />
              <span className="answer-control__feature-name">{feature.name}</span>
            </label>
            <span className="answer-control__feature-description">{feature.description}</span>
          </li>
        ))}
      </ul>

      <p className="answer-control__count">
        {checked.size} of {payload.features.length} selected
      </p>

      <div className="answer-control__actions">
        <button
          type="button"
          onClick={() => onVerdict({ kind: "features_selected", selected: [...checked] })}
        >
          Confirm selection
        </button>

        <div className="answer-control__reject">
          <textarea
            aria-label="Commentary (reject/iterate)"
            value={rejectCommentary}
            onChange={(e) => setRejectCommentary(e.target.value)}
          />
          <button
            type="button"
            disabled={!rejectCommentary.trim()}
            onClick={() =>
              onVerdict({ kind: "rejected_iteration_requested", commentary: rejectCommentary })
            }
          >
            Reject — request iteration
          </button>
        </div>
      </div>
    </div>
  );
}
