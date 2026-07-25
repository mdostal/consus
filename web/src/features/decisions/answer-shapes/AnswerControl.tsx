import { useState } from "react";
import type { DecisionPayload } from "./types";

export interface AnswerControlProps {
  payload: DecisionPayload;
  onAnswer: (answer: string) => void;
}

/**
 * Resolves the deterministic primary control from the payload's
 * AnswerShape — the real choice + a real Submit always appear, never a
 * lone generic "Approve" button standing in for an actual decision (REQ-11).
 */
export function AnswerControl({ payload, onAnswer }: AnswerControlProps) {
  switch (payload.answerShape) {
    case "yes_no":
      return (
        <div role="group" aria-label="Yes or no">
          <button type="button" onClick={() => onAnswer("yes")}>
            Yes
          </button>
          <button type="button" onClick={() => onAnswer("no")}>
            No
          </button>
        </div>
      );

    case "choose_one":
      return (
        <div role="group" aria-label="Choose one">
          {(payload.choices ?? []).map((choice) => (
            <button key={choice} type="button" onClick={() => onAnswer(choice)}>
              {choice}
            </button>
          ))}
        </div>
      );

    case "survey":
      return <SurveyControl choices={payload.choices ?? []} onAnswer={onAnswer} />;

    case "edit":
      return <EditControl onAnswer={onAnswer} />;

    case "approve":
      return (
        <button type="button" onClick={() => onAnswer("approve")}>
          Approve
        </button>
      );

    default:
      return null;
  }
}

function SurveyControl({ choices, onAnswer }: { choices: string[]; onAnswer: (answer: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(choice: string) {
    setSelected((prev) => (prev.includes(choice) ? prev.filter((c) => c !== choice) : [...prev, choice]));
  }

  return (
    <div role="group" aria-label="Select any">
      {choices.map((choice) => (
        <label key={choice}>
          <input type="checkbox" checked={selected.includes(choice)} onChange={() => toggle(choice)} />
          {choice}
        </label>
      ))}
      <button type="button" onClick={() => onAnswer(JSON.stringify(selected))}>
        Send selections
      </button>
    </div>
  );
}

function EditControl({ onAnswer }: { onAnswer: (answer: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div>
      <textarea
        aria-label="Edit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="button" onClick={() => onAnswer(value)}>
        Send edits back
      </button>
    </div>
  );
}
