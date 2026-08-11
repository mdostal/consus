import type { DecisionListItem } from "../../api/decisions";
import { DecisionCard } from "./DecisionCard";
import { DECISION_TYPE_LABELS, recommendationFor } from "./decisionPresentation";

export interface DecisionDetailPanelProps {
  item: DecisionListItem | undefined;
}

/**
 * The right pane of the two-pane Decisions layout. Reuses DecisionCard for
 * items with a decision_payload — the same rendering primitive the list
 * uses — instead of inventing a second presentation for the same data.
 */
export function DecisionDetailPanel({ item }: DecisionDetailPanelProps) {
  if (!item) {
    return (
      <p data-testid="decision-detail-empty" className="decision-detail__empty">
        Select a decision to see its details.
      </p>
    );
  }

  return (
    <div data-testid="decision-detail" className="decision-detail">
      {item.decision_type ? (
        <span
          data-testid="decision-detail-type-badge"
          className={`decision-list__badge decision-list__badge--${item.decision_type}`}
        >
          {DECISION_TYPE_LABELS[item.decision_type] ?? item.decision_type}
        </span>
      ) : null}

      {item.decision_payload ? (
        <DecisionCard
          question={item.decision_payload.title}
          recommendation={recommendationFor(item)}
          payload={item.decision_payload}
          status={item.status}
          sourceDoc={item.source_body ?? undefined}
          onVerdict={() => {}}
        />
      ) : (
        <article className="decision-card decision-card--summary">
          <h2 className="decision-card__question">{item.title}</h2>
          {item.triage_bucket ? <p className="decision-card__recommendation">Triage: {item.triage_bucket}</p> : null}
          {item.source_body ? (
            <details data-testid="source-doc" className="decision-card__source">
              <summary>Source</summary>
              <div className="decision-card__source-content">{item.source_body}</div>
            </details>
          ) : null}
        </article>
      )}
    </div>
  );
}
