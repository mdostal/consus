import { useState } from "react";

export interface SurveyCreateCandidate {
  id: string;
  title: string;
}

export interface CreatedSurvey {
  id: string;
  title: string;
}

export interface SurveyCreateFormProps {
  /** Existing decisions the operator can group into this survey -- reuses
   *  whatever's already loaded, so this never triggers a second fetch. */
  availableDecisions: SurveyCreateCandidate[];
  /** Called once the survey is created, with its real id/title, so the
   *  caller can refresh the surveys list and select the new one. */
  onCreated: (survey: CreatedSurvey) => void;
}

/**
 * The real "New Survey" flow (s5): create a named survey and group any
 * number of existing decisions into it, in one form -- no raw API calls.
 * Reuses the already-real, already-complete POST /api/surveys (server/
 * routes/surveys.ts); this is UI only, no new server-side mechanism.
 */
export function SurveyCreateForm({ availableDecisions, onCreated }: SurveyCreateFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setSelectedIds(new Set());
    setError(null);
  }

  function toggleDecision(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/surveys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || undefined,
          decision_ids: Array.from(selectedIds),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}) as { error?: string })) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const created = (await res.json()) as CreatedSurvey;
      reset();
      setIsOpen(false);
      onCreated(created);
    } catch (e) {
      setError(`Could not create survey: ${(e as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <button type="button" className="survey-create__trigger" onClick={() => setIsOpen(true)}>
        + New survey
      </button>
    );
  }

  return (
    <div className="survey-create">
      <input
        aria-label="Survey title"
        placeholder="Survey title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={isSubmitting}
      />
      <textarea
        aria-label="Survey description (optional)"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={isSubmitting}
      />

      <fieldset className="survey-create__decisions">
        <legend>Include decisions ({selectedIds.size} selected)</legend>
        {availableDecisions.length === 0 ? (
          <p className="state">No existing decisions to add yet.</p>
        ) : (
          <ul className="survey-create__decision-list">
            {availableDecisions.map((d) => (
              <li key={d.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(d.id)}
                    onChange={() => toggleDecision(d.id)}
                    disabled={isSubmitting}
                  />
                  {d.title}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {error ? <p className="state state--err">{error}</p> : null}

      <div className="survey-create__actions">
        <button type="button" onClick={handleSubmit} disabled={isSubmitting || !title.trim()}>
          {isSubmitting ? "Creating…" : "Create survey"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setIsOpen(false);
          }}
          disabled={isSubmitting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
