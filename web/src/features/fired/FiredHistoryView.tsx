import { useEffect, useState } from "react";
import { fetchFiredTickets, type FiredTicket } from "../../api/fired";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; tickets: FiredTicket[] };

export function FiredHistoryView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetchFiredTickets()
      .then((tickets) => {
        if (!cancelled) setState({ status: "ready", tickets });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load fired tickets.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <div data-testid="fired-history-loading">Loading...</div>;
  }

  if (state.status === "error") {
    return (
      <p data-testid="fired-history-error" role="alert">
        Couldn&apos;t load fire history right now. {state.message}
      </p>
    );
  }

  if (state.tickets.length === 0) {
    return <p data-testid="fired-history-empty">No tickets fired yet</p>;
  }

  return (
    <table data-testid="fired-history-table">
      <thead>
        <tr>
          <th>Doc</th>
          <th>Target Repo</th>
          <th>Multica Ticket</th>
          <th>Fired By</th>
          <th>Fired At</th>
        </tr>
      </thead>
      <tbody>
        {state.tickets.map((t) => (
          <tr key={t.id}>
            <td>
              {t.repo}:{t.file_path}
            </td>
            <td>{t.target_repo}</td>
            <td>
              <a href={`/multica/issues/${t.multica_issue_id}`}>{t.multica_issue_id}</a>
            </td>
            <td>{t.fired_by}</td>
            <td>{new Date(t.fired_at).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
