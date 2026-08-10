import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchEpics, type EpicListItem } from "../../api/epics";
import { EpicCard } from "./EpicCard";
import "../../theme/tokens.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: EpicListItem[] };

export function EpicListView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetchEpics()
      .then((items) => {
        if (!cancelled) setState({ status: "ready", items });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load epics.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div data-testid="epic-list-loading">
        <article className="decision-card decision-card--summary skeleton-card">
          <h2>Loading...</h2>
        </article>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p data-testid="epic-list-error" role="alert" className="decision-list__error">
        Couldn&apos;t load epics right now. {state.message}
      </p>
    );
  }

  if (state.items.length === 0) {
    return <p data-testid="epic-list-empty">No epics yet</p>;
  }

  return (
    <ul data-testid="epic-list" className="decision-list">
      {state.items.map((epic) => (
        <li key={epic.id} className="decision-list__item" style={{ listStyleType: "none" }}>
          <Link to={`/epics/${encodeURIComponent(epic.id)}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <EpicCard epic={epic} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
