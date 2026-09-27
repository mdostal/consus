import { useId, useState } from "react";
import type { FreeTextPayload, Verdict } from "./types";

export interface FreeTextResponseProps {
  payload: FreeTextPayload;
  onVerdict: (verdict: Verdict) => void;
}

/**
 * dostal:free-text/v1 renderer — an open-ended free-text response. A single
 * textarea bound to the payload's `prompt`, submitting records a
 * `text_response` verdict with the entered text. No accept/reject pairing
 * here (unlike every other answer-shape) — a free-text prompt has no
 * "recommended" option to accept or reject, just an answer to submit.
 */
export function FreeTextResponse({ payload, onVerdict }: FreeTextResponseProps) {
  const [text, setText] = useState("");
  // Unique per instance: a survey can render several free-text members at
  // once, and a fixed id would point every <label> at the first textarea.
  const inputId = useId();

  return (
    <div className="free-text-response">
      <p className="free-text-response__context">{payload.context}</p>
      <label className="free-text-response__prompt" htmlFor={inputId}>
        {payload.prompt}
      </label>
      <textarea
        id={inputId}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="free-text-response__actions">
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => onVerdict({ kind: "text_response", text })}
        >
          Submit
        </button>
      </div>
    </div>
  );
}
