import { useEffect, useState } from "react";
import { fetchDecisions, type DecisionListItem } from "../../api/decisions";
import { DecisionCard } from "./DecisionCard";
import "../../theme/tokens.css";

const DECISION_TYPE_LABELS: Record<string, string> = {
  cba: "Architecture",
  choose: "Choose",
  survey: "Survey",
  edit: "Edit",
  quorum: "Quorum",
  doc: "Doc",
  default: "General",
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: DecisionListItem[] };

function recommendationFor(item: DecisionListItem): string | undefined {
  if (!item.decision_payload) return undefined;
  const recommended = item.decision_payload.options.find((o) => o.id === item.decision_payload!.recommended);
  return recommended ? `Recommend: ${recommended.title}` : undefined;
}

/**
 * [frontend-api-integration]: fetches the live decision queue on mount and
 * renders it — a structured DecisionCard for items with a decision_payload
 * (Minerva human_requests, CBAs), a lighter summary row for classified
 * Multica issues that carry no payload (the common case for the ~79 real
 * decisions), and a user-friendly message on load failure.
 */
export function DecisionList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetchDecisions()
      .then((items) => {
        if (!cancelled) setState({ status: "ready", items });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load decisions.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p data-testid="decision-list-loading">Loading decisions…</p>;
  }

  if (state.status === "error") {
    return (
      <p data-testid="decision-list-error" role="alert" className="decision-list__error">
        Couldn&apos;t load decisions right now. {state.message}
      </p>
    );
  }

  if (state.items.length === 0) {
    return <p data-testid="decision-list-empty">No open decisions.</p>;
  }

  return (
    <ul data-testid="decision-list" className="decision-list">
      {state.items.map((item) => (
        <li key={item.id} className="decision-list__item">
          {item.decision_type ? (
            <span
              data-testid="decision-type-badge"
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
              onVerdict={() => {}}
            />
          ) : (
            <article className="decision-card decision-card--summary">
              <h2 className="decision-card__question">{item.title}</h2>
              {item.triage_bucket ? <p className="decision-card__recommendation">Triage: {item.triage_bucket}</p> : null}
            </article>
          )}
        </li>
      ))}
    </ul>
  );
}
