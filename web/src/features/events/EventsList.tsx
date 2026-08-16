export type EventTriggerKind = "doc_changed" | "decision_needed";
export type EventStatus = "new" | "in_progress" | "done" | "dismissed";

/** Mirrors server/events/store.ts's EventRow exactly — snake_case, straight
 *  off the wire from GET /api/events(+/history). */
export interface EventRow {
  id: string;
  project: string;
  trigger_kind: EventTriggerKind;
  source_repo: string;
  source_path: string;
  content_hash: string;
  previous_hash: string | null;
  diff: string | null;
  item_id: string | null;
  composed_prompt: string;
  status: EventStatus;
  detected_at: string;
  status_updated_at: string;
  archived_at: string | null;
  proposal_id: string | null;
}

const STATUSES: EventStatus[] = ["new", "in_progress", "done", "dismissed"];

export interface EventsListProps {
  events: EventRow[];
  /** Active vs. archived — purely for empty-state copy; the array itself
   *  already reflects whichever endpoint the caller fetched from. */
  viewMode: "active" | "archived";
  onStatusChange: (id: string, status: EventStatus) => void;
  onPropose: (event: EventRow) => void;
}

/**
 * p14-5/s1: presentational events table — mirrors DocBrowser's shape (a
 * data prop in, callback props out, no internal fetching). One row per
 * event; a status <select> exposing all four values; a "Propose a change"
 * button present only when event.diff is not null (decision_needed events
 * have a null diff and p14-3's propose route rejects those with 400 — this
 * list must never offer that action for them).
 */
export function EventsList({ events, viewMode, onStatusChange, onPropose }: EventsListProps) {
  if (events.length === 0) {
    return (
      <div className="empty">
        <strong>{viewMode === "archived" ? "No archived events" : "No events yet"}</strong>
        {viewMode === "archived"
          ? "Events land here once they're marked done or dismissed."
          : "Run a scan to detect doc changes and decisions needing review."}
      </div>
    );
  }

  return (
    <table className="events-list">
      <thead>
        <tr>
          <th>Project</th>
          <th>Trigger</th>
          <th>Source</th>
          <th>Detected</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} data-testid={`event-row-${event.id}`}>
            <td>{event.project}</td>
            <td>{event.trigger_kind}</td>
            <td>{event.source_path}</td>
            <td>{event.detected_at}</td>
            <td>
              <select
                aria-label={`Status for ${event.source_path}`}
                value={event.status}
                onChange={(e) => onStatusChange(event.id, e.target.value as EventStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </td>
            <td className="events-list__actions">
              {event.diff !== null ? (
                <button type="button" onClick={() => onPropose(event)}>
                  Propose a change
                </button>
              ) : null}
              {event.proposal_id ? <span className="pill pill--pending">proposed</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
