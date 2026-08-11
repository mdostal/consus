import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchDecisions, type DecisionListItem } from "../../api/decisions";
import { DecisionList } from "./DecisionList";
import { DecisionDetailPanel } from "./DecisionDetailPanel";
import "./decisions-view.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: DecisionListItem[] };

/**
 * Two-pane Decisions layout: a left list pane and a right detail pane, each
 * scrolling independently. Owns the single fetchDecisions() call and hands
 * the same items to both DecisionList and DecisionDetailPanel so selecting
 * a row never re-fetches or re-renders the list. Selection is a `?selected=`
 * query param on "/" so it's shareable/back-button-friendly without
 * introducing a new route.
 */
export function DecisionsView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("selected") ?? undefined;

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

  function handleSelect(item: DecisionListItem) {
    const next = new URLSearchParams(searchParams);
    next.set("selected", item.id);
    setSearchParams(next, { replace: true });
  }

  const selectedItem = state.status === "ready" ? state.items.find((item) => item.id === selectedId) : undefined;

  return (
    <div className="decisions-view">
      <div className="decisions-view__list-pane" data-testid="decisions-view-list-pane">
        {state.status === "loading" ? (
          <p data-testid="decision-list-loading">Loading decisions…</p>
        ) : state.status === "error" ? (
          <p data-testid="decision-list-error" role="alert" className="decision-list__error">
            Couldn&apos;t load decisions right now. {state.message}
          </p>
        ) : (
          <DecisionList items={state.items} selectedId={selectedId} onSelect={handleSelect} />
        )}
      </div>
      <div className="decisions-view__detail-pane" data-testid="decisions-view-detail-pane">
        <DecisionDetailPanel item={selectedItem} />
      </div>
    </div>
  );
}
