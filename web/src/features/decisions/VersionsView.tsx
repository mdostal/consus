export interface DecisionLogEntry {
  log_id: string;
  timestamp: string;
  actor: string;
  prompt: string;
  scope: { section?: string; diagram?: string } | null;
  agent: { id: string; name: string } | null;
  comment_id: string;
  status_set: string | null;
  previous_status: string | null;
}

export interface VersionsViewProps {
  originalContent: string;
  entries: DecisionLogEntry[];
}

/**
 * REQ-16's own scope: a list of iterate-requests alongside the original
 * content, so a reviewer can see what was requested and when. Deliberately
 * NOT a side-by-side diff/sectional-comparison UI — that's REQ-18,
 * out of scope here (see design-discussion.md §3).
 */
export function VersionsView({ originalContent, entries }: VersionsViewProps) {
  return (
    <div className="versions-view">
      <section className="versions-view__original">
        <h4>Original</h4>
        <p>{originalContent}</p>
      </section>

      <section className="versions-view__requests">
        <h4>Iterate requests</h4>
        {entries.length === 0 ? (
          <p className="state">No iterate requests yet.</p>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li key={entry.log_id}>
                <time dateTime={entry.timestamp}>{entry.timestamp}</time>
                <span> — {entry.actor}: {entry.prompt}</span>
                {entry.agent ? <span className="versions-view__agent"> (agent: {entry.agent.name})</span> : null}
                {entry.scope?.section ? <span> [section: {entry.scope.section}]</span> : null}
                {entry.scope?.diagram ? <span> [diagram: {entry.scope.diagram}]</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
