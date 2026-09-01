import { useCallback, useEffect, useState } from "react";
import { DecisionCard } from "./DecisionCard";
import type { DecisionPayload, Verdict } from "./answer-shapes/types";

export interface SurveyDecisionItem {
  id: string;
  title: string;
  status: string;
  decided_at: string | null;
  decision_payload: DecisionPayload | null;
  source_repo: string | null;
  recommendation?: string;
}

export interface SurveyViewProps {
  surveyId: string;
  surveyTitle: string;
  /** Called after any verdict is successfully recorded, so the outer list can refresh counts. */
  onVerdictRecorded?: () => void;
}

function verdictLabel(v: Verdict): string {
  switch (v.kind) {
    case "accepted":
      return "Accepted the recommended option";
    case "option_chosen":
      return `Chose option ${v.optionId}`;
    case "mix":
      return `Mixed options ${v.optionIds.join(" + ")} — ${v.why}`;
    case "rejected_iteration_requested":
      return `Requested another round — ${v.commentary}`;
    default:
      return "Answered";
  }
}

async function postVerdict(itemId: string, verdict: Verdict): Promise<void> {
  const res = await fetch(`/api/decisions/${itemId}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verdict, actor: "Mathew" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/**
 * Stepped/scrollable survey view for multi-question answering sessions.
 * Fetches the survey's member decisions, tracks progress, and shows
 * a "Survey complete" summary once all members have been answered.
 */
export function SurveyView({ surveyId, surveyTitle, onVerdictRecorded }: SurveyViewProps) {
  const [members, setMembers] = useState<SurveyDecisionItem[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  /** Verdicts recorded in this session (id -> verdict). Pre-decided items are tracked via decided_at. */
  const [recorded, setRecorded] = useState<Record<string, Verdict>>({});
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});

  const loadMembers = useCallback(() => {
    setFetchError(null);
    fetch(`/api/decisions?survey=${encodeURIComponent(surveyId)}&all=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((items: SurveyDecisionItem[]) => setMembers(items))
      .catch((e: Error) => setFetchError(e.message));
  }, [surveyId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function submitVerdict(memberId: string, verdict: Verdict) {
    setSubmitErrors((prev) => {
      const next = { ...prev };
      delete next[memberId];
      return next;
    });
    try {
      await postVerdict(memberId, verdict);
      setRecorded((prev) => ({ ...prev, [memberId]: verdict }));
      onVerdictRecorded?.();
    } catch (e) {
      setSubmitErrors((prev) => ({ ...prev, [memberId]: (e as Error).message }));
    }
  }

  if (fetchError) {
    return (
      <div className="survey-view">
        <header className="survey-view__head">
          <h2 className="survey-view__title">{surveyTitle}</h2>
        </header>
        <p className="state state--err">Could not load survey members: {fetchError}</p>
      </div>
    );
  }

  if (!members) {
    return (
      <div className="survey-view">
        <header className="survey-view__head">
          <h2 className="survey-view__title">{surveyTitle}</h2>
        </header>
        <p className="state">Loading survey…</p>
      </div>
    );
  }

  const totalCount = members.length;
  const answeredCount = members.filter((m) => m.decided_at || recorded[m.id]).length;
  const allAnswered = totalCount > 0 && answeredCount === totalCount;

  return (
    <div className="survey-view">
      <header className="survey-view__head">
        <h2 className="survey-view__title">{surveyTitle}</h2>
        <div
          className="survey-view__progress"
          aria-label={`${answeredCount} of ${totalCount} answered`}
        >
          <span className="survey-view__progress-text">
            {answeredCount} of {totalCount} answered
          </span>
          <div className="survey-view__progress-bar" role="progressbar" aria-valuenow={answeredCount} aria-valuemin={0} aria-valuemax={totalCount}>
            <div
              className="survey-view__progress-fill"
              style={{ width: totalCount > 0 ? `${(answeredCount / totalCount) * 100}%` : "0%" }}
            />
          </div>
        </div>
      </header>

      {allAnswered ? (
        <section className="survey-view__complete" data-testid="survey-complete">
          <h3 className="survey-view__complete-heading">Survey complete</h3>
          <p className="survey-view__complete-subtext">All {totalCount} decisions have been answered.</p>
          <ul className="survey-view__summary">
            {members.map((m) => {
              const sessionVerdict = recorded[m.id];
              return (
                <li key={m.id} className="survey-view__summary-item">
                  <span className="survey-view__summary-title">{m.title}</span>
                  <span className="survey-view__summary-verdict">
                    {sessionVerdict ? verdictLabel(sessionVerdict) : `Decided ${new Date(m.decided_at as string).toLocaleString()}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="survey-view__members">
        {members.map((member, idx) => {
          const isAnswered = Boolean(member.decided_at || recorded[member.id]);
          const sessionVerdict = recorded[member.id];

          return (
            <section
              key={member.id}
              className={`survey-view__member ${isAnswered ? "survey-view__member--answered" : ""}`}
              data-testid={`survey-member-${member.id}`}
            >
              <div className="survey-view__member-header">
                <span className="survey-view__member-num">{idx + 1} of {totalCount}</span>
                {isAnswered ? (
                  <span className="survey-view__member-answered-badge" data-testid={`answered-badge-${member.id}`}>
                    ✓ Answered
                  </span>
                ) : null}
              </div>

              {member.decision_payload ? (
                <>
                  {sessionVerdict ? (
                    <div className="dv__recorded" data-testid={`verdict-recorded-${member.id}`}>
                      ✓ Recorded: {verdictLabel(sessionVerdict)}
                    </div>
                  ) : member.decided_at ? (
                    <p className="dv__decided-note">
                      Decided {new Date(member.decided_at).toLocaleString()}. Submit a new verdict below to revise.
                    </p>
                  ) : null}
                  {!sessionVerdict ? (
                    <DecisionCard
                      question={member.title}
                      payload={member.decision_payload}
                      status={member.status !== "open" ? member.status : undefined}
                      onVerdict={(v) => submitVerdict(member.id, v)}
                    />
                  ) : null}
                </>
              ) : (
                <p className="dv__hint">No structured decision on this item.</p>
              )}

              {submitErrors[member.id] ? (
                <p className="dv__err" data-testid={`submit-error-${member.id}`}>
                  Could not record decision: {submitErrors[member.id]}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
