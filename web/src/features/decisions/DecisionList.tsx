import { useEffect, useState, type KeyboardEvent } from "react";
import { fetchDecisions, type DecisionListItem } from "../../api/decisions";
import { DecisionCard } from "./DecisionCard";
import { DECISION_TYPE_LABELS, recommendationFor } from "./decisionPresentation";
import "../../theme/tokens.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: DecisionListItem[] };

export interface DecisionListProps {
  /** When provided, the list renders these items directly instead of
   *  fetching its own — lets a parent (DecisionsView) own one shared fetch
   *  and hand the same items to both the list and detail panes. */
  items?: DecisionListItem[];
  /** id of the item to highlight as selected (e.g. driven by ?selected=). */
  selectedId?: string;
  /** called when a row is activated (click or Enter/Space). Rows are only
   *  interactive when this is provided. */
  onSelect?: (item: DecisionListItem) => void;
}

/**
 * [frontend-api-integration]: fetches the live decision queue on mount and
 * renders it — a structured DecisionCard for items with a decision_payload
 * (Minerva human_requests, CBAs), a lighter summary row for classified
 * Multica issues that carry no payload (the common case for the ~79 real
 * decisions), and a user-friendly message on load failure. Pass `items` to
 * skip the internal fetch and render externally-supplied data instead.
 */
export function DecisionList({ items: controlledItems, selectedId, onSelect }: DecisionListProps = {}) {
  const [state, setState] = useState<LoadState>(() =>
    controlledItems ? { status: "ready", items: controlledItems } : { status: "loading" },
  );

  useEffect(() => {
    if (controlledItems) {
      setState({ status: "ready", items: controlledItems });
      return;
    }

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
  }, [controlledItems]);

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

  function activate(item: DecisionListItem) {
    onSelect?.(item);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>, item: DecisionListItem) {
    if (!onSelect) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(item);
    }
  }

  return (
    <ul data-testid="decision-list" className="decision-list" role={onSelect ? "listbox" : undefined}>
      {state.items.map((item) => {
        const isSelected = onSelect ? item.id === selectedId : false;
        return (
          <li
            key={item.id}
            className={`decision-list__item${isSelected ? " decision-list__item--selected" : ""}`}
            role={onSelect ? "option" : undefined}
            aria-selected={onSelect ? isSelected : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onClick={onSelect ? () => activate(item) : undefined}
            onKeyDown={onSelect ? (event) => handleKeyDown(event, item) : undefined}
          >
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
        );
      })}
    </ul>
  );
}
