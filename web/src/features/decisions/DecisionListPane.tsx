import type { KeyboardEvent } from "react";
import { SurveyCreateForm, type CreatedSurvey, type SurveyCreateCandidate } from "./surveys/SurveyCreateForm";

/** Structurally compatible with App.tsx's DecisionItem — duck-typed on
 *  purpose so this file has no import from App.tsx. */
export interface DecisionListItem {
  id: string;
  title: string;
  status: string;
  decided_at: string | null;
  decision_type?: string | null;
  survey_id?: string | null;
  created_at?: string;
}

export interface SurveyListItem {
  id: string;
  title: string;
  answered: number;
  total: number;
  /** Set when the survey was imported from an operator question ticket. */
  question_ticket?: { ticket_id: string; identifier: string } | null;
}

function Row({
  item,
  selected,
  onSelect,
  nested = false,
}: {
  item: DecisionListItem;
  selected: boolean;
  onSelect: (id: string) => void;
  /** A question listed under its ticket's survey row. */
  nested?: boolean;
}) {
  function handleKeyDown(e: KeyboardEvent<HTMLLIElement>) {
    // Space's default behavior (page scroll) is only relevant when the
    // element is focused and interactive — suppress it here so keyboard
    // activation feels like a real control, matching Enter.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(item.id);
    }
  }

  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={`decision-list__row ${nested ? "decision-list__row--question" : ""} ${selected ? "decision-list__row--selected" : ""}`}
      onClick={() => onSelect(item.id)}
      onKeyDown={handleKeyDown}
    >
      <span className="decision-list__row-title">{item.title}</span>
      <span className="decision-list__row-meta">
        <span className={`dv__pill ${item.decided_at ? "dv__pill--done" : ""}`}>{item.status}</span>
        {item.decision_type ? <span className="decision-list__row-type">{item.decision_type}</span> : null}
      </span>
    </li>
  );
}

function SurveyRow({
  survey,
  selected,
  onSelect,
}: {
  survey: SurveyListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  function handleKeyDown(e: KeyboardEvent<HTMLLIElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(survey.id);
    }
  }

  const isComplete = survey.answered === survey.total && survey.total > 0;

  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={`decision-list__row decision-list__row--survey ${selected ? "decision-list__row--selected" : ""}`}
      onClick={() => onSelect(survey.id)}
      onKeyDown={handleKeyDown}
      data-testid={`survey-row-${survey.id}`}
    >
      {survey.question_ticket ? (
        <span className="decision-list__row-title">
          <span className="decision-list__ticket" data-testid={`survey-ticket-${survey.id}`}>
            {survey.question_ticket.identifier}
          </span>{" "}
          Questions for you
        </span>
      ) : (
        <span className="decision-list__row-title">{survey.title}</span>
      )}
      <span className="decision-list__row-meta">
        <span
          className={`dv__pill ${isComplete ? "dv__pill--done" : ""}`}
          data-testid={`survey-badge-${survey.id}`}
        >
          {survey.answered}/{survey.total} answered
        </span>
      </span>
    </li>
  );
}

/**
 * Presentational left-pane list for the Decisions two-pane layout —
 * compact, clickable/keyboard-activatable rows grouped under the same
 * "Needs you (N)" / "Decided (N)" headings the old flat layout used,
 * rather than a full DecisionView/DecisionCard per row (that's exactly the
 * unscannable-list problem this layout fixes).
 *
 * Surveys appear at the top of "Needs you" with an (N/M answered) badge
 * so operators can answer a multi-question session in one flow. Operator
 * question tickets come first of all, each grouped with its open questions.
 */
export function DecisionListPane({
  items,
  selectedId,
  onSelect,
  surveys = [],
  selectedSurveyId = null,
  onSelectSurvey,
  onSurveyCreated,
}: {
  items: DecisionListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  surveys?: SurveyListItem[];
  selectedSurveyId?: string | null;
  onSelectSurvey?: (id: string) => void;
  /** s5: when set, renders the real "New Survey" creation flow above the
   *  list, grouping any of `items` into a new survey -- no raw API calls. */
  onSurveyCreated?: (survey: CreatedSurvey) => void;
}) {
  const open = items.filter((d) => !d.decided_at);
  const decided = items.filter((d) => d.decided_at);
  const incompleteSurveys = surveys.filter((s) => s.answered < s.total);
  const completeSurveys = surveys.filter((s) => s.total > 0 && s.answered === s.total);

  // consus#211: open operator question tickets are pinned first, one group
  // per ticket — its survey row, then its still-open questions — so a fresh
  // question never sits behind a long tail of older decisions.
  const questionSurveys = incompleteSurveys.filter((s) => s.question_ticket);
  const otherSurveys = incompleteSurveys.filter((s) => !s.question_ticket);
  const pinnedSurveyIds = new Set(questionSurveys.map((s) => s.id));
  const openUnpinned = open.filter((d) => !(d.survey_id && pinnedSurveyIds.has(d.survey_id)));

  const needsYouCount = incompleteSurveys.length + open.length;
  const availableDecisions: SurveyCreateCandidate[] = items.map((d) => ({ id: d.id, title: d.title }));

  return (
    <div className="decision-list">
      {onSurveyCreated ? (
        <div className="decision-list__survey-create">
          <SurveyCreateForm availableDecisions={availableDecisions} onCreated={onSurveyCreated} />
        </div>
      ) : null}

      <p className="group-heading">Needs you ({needsYouCount})</p>
      {needsYouCount === 0 ? (
        <div className="empty">
          <strong>Nothing waiting on you</strong>
          Every open decision has been answered. New decisions land here as agents surface them.
        </div>
      ) : (
        <ul className="decision-list__group" role="listbox" aria-label="Needs you">
          {questionSurveys.map((s) => (
            <li key={s.id} role="presentation" className="decision-list__ticket-group">
              <ul role="group" aria-label={s.title} data-testid={`question-group-${s.id}`}>
                <SurveyRow survey={s} selected={s.id === selectedSurveyId} onSelect={onSelectSurvey ?? (() => {})} />
                {open
                  .filter((d) => d.survey_id === s.id)
                  // The ticket's question order, not last activity.
                  .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
                  .map((d) => (
                    <Row key={d.id} item={d} selected={d.id === selectedId} onSelect={onSelect} nested />
                  ))}
              </ul>
            </li>
          ))}
          {otherSurveys.map((s) => (
            <SurveyRow
              key={s.id}
              survey={s}
              selected={s.id === selectedSurveyId}
              onSelect={onSelectSurvey ?? (() => {})}
            />
          ))}
          {openUnpinned.map((d) => (
            <Row key={d.id} item={d} selected={d.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}

      {(decided.length > 0 || completeSurveys.length > 0) ? (
        <>
          <p className="group-heading">Decided ({decided.length + completeSurveys.length})</p>
          <ul className="decision-list__group" role="listbox" aria-label="Decided">
            {completeSurveys.map((s) => (
              <SurveyRow
                key={s.id}
                survey={s}
                selected={s.id === selectedSurveyId}
                onSelect={onSelectSurvey ?? (() => {})}
              />
            ))}
            {decided.map((d) => (
              <Row key={d.id} item={d} selected={d.id === selectedId} onSelect={onSelect} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
