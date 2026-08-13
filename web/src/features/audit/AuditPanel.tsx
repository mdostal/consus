export type AuditTrailEntry =
  | {
      kind: "audit";
      id: number;
      actor: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      timestamp: string;
    }
  | {
      kind: "proposal";
      id: string;
      target_type: string;
      description: string;
      status: string;
      requested_by: string;
      timestamp: string;
      applied_diff: string | null;
      failure_reason: string | null;
    };

export interface AuditPanelProps {
  entries: AuditTrailEntry[];
}

/**
 * s5: the shared history panel — one component for decisions, diagrams,
 * and docs alike (backed by GET /api/items/:id/audit-trail, which is
 * likewise one route for all three). Renders plain audit_log entries and
 * proposals (s3, any status) in a single timeline, clearly distinguished
 * so a reader isn't left guessing which kind of record they're looking at.
 */
export function AuditPanel({ entries }: AuditPanelProps) {
  if (entries.length === 0) {
    return <p className="audit-panel__empty state">No history yet.</p>;
  }

  return (
    <ul className="audit-panel">
      {entries.map((entry) =>
        entry.kind === "audit" ? (
          <li key={`audit-${entry.id}`} className="audit-panel__entry audit-panel__entry--audit">
            <span className="audit-panel__badge">audit</span>
            <span>
              {entry.actor} changed {entry.field}: {entry.old_value ?? "—"} → {entry.new_value ?? "—"}
            </span>
            <time dateTime={entry.timestamp}>{entry.timestamp}</time>
          </li>
        ) : (
          <li key={`proposal-${entry.id}`} className="audit-panel__entry audit-panel__entry--proposal">
            <span className={`audit-panel__badge audit-panel__badge--${entry.status}`}>
              proposal · {entry.status}
            </span>
            <span>
              {entry.requested_by} proposed a change to this {entry.target_type}: {entry.description}
              {entry.status === "failed" && entry.failure_reason ? ` (${entry.failure_reason})` : null}
            </span>
            <time dateTime={entry.timestamp}>{entry.timestamp}</time>
          </li>
        ),
      )}
    </ul>
  );
}
