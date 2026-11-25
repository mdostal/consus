import { useState } from "react";

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
      /** Set when the harness never received the proposal; such a failure
       *  can be retried via POST /api/proposals/:id/redeliver. Absent on
       *  older servers. */
      delivery_error?: string | null;
      /** The PR the harness opened for an applied change (consus#203).
       *  Absent on older servers. */
      pr_url?: string | null;
    };

/** Only an http(s) link is ever rendered as an href — mirrors the server's
 *  isPrUrl check, in case an older row or server slips something else by. */
export function safePrUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** The proposal fields POST /api/proposals/:id/redeliver hands back. */
interface RedeliveredProposal {
  status: string;
  failure_reason: string | null;
  delivery_error: string | null;
}

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
  // Redelivery outcomes, keyed by proposal id, overlaid on `entries` so a
  // retry shows its result without every caller having to refetch.
  const [redelivered, setRedelivered] = useState<Record<string, RedeliveredProposal>>({});
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<{ id: string; message: string } | null>(null);

  function redeliver(id: string) {
    setRetrying(id);
    setRetryError(null);
    fetch(`/api/proposals/${encodeURIComponent(id)}/redeliver`, { method: "POST" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setRedelivered((prev) => ({ ...prev, [id]: body as RedeliveredProposal }));
      })
      .catch((e: Error) => setRetryError({ id, message: e.message }))
      .finally(() => setRetrying(null));
  }

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
          <ProposalEntry
            key={`proposal-${entry.id}`}
            entry={{ ...entry, ...redelivered[entry.id] }}
            retrying={retrying === entry.id}
            retryError={retryError?.id === entry.id ? retryError.message : null}
            onRedeliver={() => redeliver(entry.id)}
          />
        ),
      )}
    </ul>
  );
}

function ProposalEntry({
  entry,
  retrying,
  retryError,
  onRedeliver,
}: {
  entry: Extract<AuditTrailEntry, { kind: "proposal" }>;
  retrying: boolean;
  retryError: string | null;
  onRedeliver: () => void;
}) {
  const prUrl = entry.status === "applied" ? safePrUrl(entry.pr_url) : null;
  return (
    <li className="audit-panel__entry audit-panel__entry--proposal">
      <span className={`audit-panel__badge audit-panel__badge--${entry.status}`}>
        proposal · {entry.status}
      </span>
      <span>
        {entry.requested_by} proposed a change to this {entry.target_type}: {entry.description}
        {entry.status === "failed" && entry.failure_reason ? ` (${entry.failure_reason})` : null}
      </span>
      {prUrl ? (
        <a className="audit-panel__pr-link" href={prUrl} target="_blank" rel="noopener noreferrer">
          View PR
        </a>
      ) : null}
      <time dateTime={entry.timestamp}>{entry.timestamp}</time>
      {entry.status === "failed" && entry.delivery_error ? (
        <button type="button" onClick={onRedeliver} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry delivery"}
        </button>
      ) : null}
      {retryError ? <span role="alert">Retry failed: {retryError}</span> : null}
    </li>
  );
}
