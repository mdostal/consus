import { useState } from "react";
import type { EventRow } from "./EventsList";

export interface EventProposeComposerProps {
  event: EventRow;
  onCancel: () => void;
  onSubmit: (description: string) => void;
  error?: string | null;
}

/**
 * p14-5/s2: a new, purpose-built propose composer — not a reuse of
 * DocRenderer's edit/fire form (see this story's design_decisions: that
 * form computes a diff from a live textarea edit against original content,
 * which has no equivalent here since an event's diff is already fixed,
 * server-composed data from p14-2). Mirrors DocRenderer's interaction
 * *shape* instead: a read-only diff, a required description input, and
 * Cancel/Propose buttons with Propose disabled until description is
 * non-empty (DocRenderer's `disabled={!hasChanges || !state.description.trim()}`
 * pattern, minus the hasChanges check — nothing here is user-edited).
 */
export function EventProposeComposer({ event, onCancel, onSubmit, error }: EventProposeComposerProps) {
  const [description, setDescription] = useState("");

  return (
    <div className="event-propose-composer">
      <header className="event-propose-composer__head">
        <h3>Propose a change</h3>
        <p>
          {event.source_repo} — {event.source_path}
        </p>
      </header>

      {event.composed_prompt ? <p className="event-propose-composer__prompt">{event.composed_prompt}</p> : null}

      <pre data-testid="event-diff" className="event-propose-composer__diff">
        {event.diff}
      </pre>

      <label className="event-propose-composer__description">
        Description
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe why this change is being proposed"
        />
      </label>

      {error ? <p className="dv__err">{error}</p> : null}

      <div className="event-propose-composer__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={() => onSubmit(description.trim())} disabled={!description.trim()}>
          Propose
        </button>
      </div>
    </div>
  );
}
