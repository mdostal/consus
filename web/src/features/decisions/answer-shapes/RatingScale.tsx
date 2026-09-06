import { useState } from "react";
import type { RatingPayload, Verdict } from "./types";

export interface RatingScaleProps {
  payload: RatingPayload;
  onVerdict: (verdict: Verdict) => void;
}

/**
 * dostal:rating/v1 renderer — a numeric rating scale spanning
 * `payload.scale.min`..`payload.scale.max` inclusive, one button per value.
 * A button's visible text is its optional label (`scale.labels[value]`) when
 * given, otherwise the bare number. Picking a value selects it (visually, via
 * aria-pressed); a separate "Submit rating" action records the `rated`
 * verdict — mirrors the rest of the answer-shape family's
 * select-then-confirm pattern (mix, features_selected) rather than firing on
 * the first click.
 */
export function RatingScale({ payload, onVerdict }: RatingScaleProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const { min, max, labels } = payload.scale;

  const values: number[] = [];
  for (let value = min; value <= max; value += 1) {
    values.push(value);
  }

  return (
    <div className="rating-scale">
      <p className="rating-scale__context">{payload.context}</p>
      <p className="rating-scale__prompt">{payload.prompt}</p>

      <div className="rating-scale__values" role="group" aria-label={payload.prompt}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className="rating-scale__value"
            aria-pressed={selected === value}
            onClick={() => setSelected(value)}
          >
            {labels?.[value] ?? value}
          </button>
        ))}
      </div>

      <div className="rating-scale__actions">
        <button
          type="button"
          disabled={selected === null}
          onClick={() => {
            if (selected !== null) onVerdict({ kind: "rated", value: selected });
          }}
        >
          Submit rating
        </button>
      </div>
    </div>
  );
}
