import { useCallback, useEffect, useRef, useState } from "react";
import { DecisionCard } from "./DecisionCard";
import { NoContextWarning } from "./NoContextWarning";
import { AttachmentsPanel } from "./attachments/AttachmentsPanel";
import { ArtifactLinksPanel } from "../artifact-links/ArtifactLinksPanel";
import { CommentsPanel } from "../comments/CommentsPanel";
import type { DecisionPayload, Verdict } from "./answer-shapes/types";

export interface SurveyDecisionItem {
  id: string;
  title: string;
  status: string;
  decided_at: string | null;
  decision_payload: DecisionPayload | null;
  source_repo: string | null;
  recommendation?: string;
  /** Live attachments + artifact links (PANT-919); absent on older servers. */
  supporting_material_count?: number;
}

export interface SurveyViewProps {
  surveyId: string;
  surveyTitle: string;
  /** Called after any verdict is successfully recorded, so the outer list can refresh counts. */
  onVerdictRecorded?: () => void;
  /** Move keyboard focus to the survey heading on mount -- set right after
   *  the survey was created, so focus doesn't stay on the (now closed)
   *  creation form (PANT-812). */
  focusHeadingOnMount?: boolean;
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
  const res = await fetch(`/api/decisions/${encodeURIComponent(itemId)}/verdict`, {
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
export function SurveyView({ surveyId, surveyTitle, onVerdictRecorded, focusHeadingOnMount = false }: SurveyViewProps) {
  const [members, setMembers] = useState<SurveyDecisionItem[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  /** Verdicts recorded in this session (id -> verdict). Pre-decided items are tracked via decided_at. */
  const [recorded, setRecorded] = useState<Record<string, Verdict>>({});
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});
  // Answering unmounts that member's DecisionCard, which held keyboard focus;
  // hand focus to its "Recorded" note instead of letting it drop to <body>
  // (PANT-812), so Tab continues on to the next member.
  const focusRecordedFor = useRef<string | null>(null);

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

  // The loading/error/loaded branches below render the heading at the same
  // position, so React keeps the one <h2> node -- focus survives the load.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeadingOnMount) headingRef.current?.focus();
    // Mount-only by design: never steal focus back on later re-renders.
  }, []);

  async function submitVerdict(memberId: string, verdict: Verdict) {
    setSubmitErrors((prev) => {
      const next = { ...prev };
      delete next[memberId];
      return next;
    });
    try {
      await postVerdict(memberId, verdict);
      focusRecordedFor.current = memberId;
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
          <h2 ref={headingRef} className="survey-view__title" tabIndex={-1}>
            {surveyTitle}
          </h2>
        </header>
        <p className="state state--err">Could not load survey members: {fetchError}</p>
      </div>
    );
  }

  if (!members) {
    return (
      <div className="survey-view">
        <header className="survey-view__head">
          <h2 ref={headingRef} className="survey-view__title" tabIndex={-1}>
            {surveyTitle}
          </h2>
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
        <h2 ref={headingRef} className="survey-view__title" tabIndex={-1}>
            {surveyTitle}
          </h2>
        <div className="survey-view__progress">
          <span className="survey-view__progress-text" aria-live="polite">
            {answeredCount} of {totalCount} answered
          </span>
          <div
            className="survey-view__progress-bar"
            role="progressbar"
            aria-label="Survey progress"
            aria-valuenow={answeredCount}
            aria-valuemin={0}
            aria-valuemax={totalCount}
            aria-valuetext={`${answeredCount} of ${totalCount} answered`}
          >
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

              {/* Outside the collapsed <details> below on purpose: an empty
                  "Supporting material" section is invisible until opened. */}
              <NoContextWarning count={member.supporting_material_count} />

              {member.decision_payload ? (
                <>
                  {sessionVerdict ? (
                    <div
                      className="dv__recorded"
                      data-testid={`verdict-recorded-${member.id}`}
                      tabIndex={-1}
                      ref={(el) => {
                        if (el && focusRecordedFor.current === member.id) {
                          focusRecordedFor.current = null;
                          el.focus();
                        }
                      }}
                    >
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

              {/* Collapsed by default (s3 design call): a multi-member survey with
                  always-expanded, mostly-empty panels per question is visual noise --
                  most questions won't have attachments/links. Kept outside the
                  !sessionVerdict check above so supporting material stays reachable
                  after answering, matching how a standalone DecisionView never hides
                  its own Attachments/Artifact links sections once decided. */}
              <details className="survey-view__member-supporting">
                <summary>Supporting material</summary>
                <div className="survey-view__member-supporting-body">
                  <h3 className="dv__section-title">Discussion</h3>
                  <CommentsPanel itemId={member.id} />
                  <h3 className="dv__section-title">Attachments</h3>
                  <AttachmentsPanel itemId={member.id} />
                  <h3 className="dv__section-title">Artifact links</h3>
                  <ArtifactLinksPanel itemId={member.id} />
                </div>
              </details>
            </section>
          );
        })}
      </div>
    </div>
  );
}
