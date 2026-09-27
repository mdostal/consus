import { useEffect, useRef, useState, type FormEvent } from "react";

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
  const titleRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Where keyboard focus should land after the form opens or is cancelled
  // (PANT-812). A successful create deliberately leaves focus alone: the
  // caller selects the new survey and SurveyView focuses its heading.
  const focusAfterToggle = useRef<"title" | "trigger" | null>(null);

  useEffect(() => {
    const target = focusAfterToggle.current;
    focusAfterToggle.current = null;
    if (target === "title") titleRef.current?.focus();
    else if (target === "trigger") triggerRef.current?.focus();
  }, [isOpen]);

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

  function open() {
    focusAfterToggle.current = "title";
    setIsOpen(true);
  }

  function cancel() {
    reset();
    focusAfterToggle.current = "trigger";
    setIsOpen(false);
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
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
      <button ref={triggerRef} type="button" className="survey-create__trigger" onClick={open}>
        + New survey
      </button>
    );
  }

  return (
    <form className="survey-create" aria-label="New survey" onSubmit={handleSubmit}>
      <label className="survey-create__field">
        Survey title
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isSubmitting}
          required
        />
      </label>
      <label className="survey-create__field">
        Survey description (optional)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={isSubmitting} />
      </label>

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

      {error ? (
        <p className="state state--err" role="alert">
          {error}
        </p>
      ) : null}

      <div className="survey-create__actions">
        <button type="submit" disabled={isSubmitting || !title.trim()}>
          {isSubmitting ? "Creating…" : "Create survey"}
        </button>
        <button type="button" onClick={cancel} disabled={isSubmitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
