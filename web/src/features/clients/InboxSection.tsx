import { useEffect, useState } from "react";

export type InboxKind = "question" | "proposal" | "reply";

/** GET /api/inbox entry (server/inbox/query.ts). */
export interface InboxEntry {
  kind: InboxKind;
  key: string;
  itemId: string;
  itemType: string;
  isDecision: boolean;
  title: string;
  repo: string | null;
  client: string | null;
  at: string;
  detail: string | null;
  proposalId?: string;
}

const KIND_LABEL: Record<InboxKind, string> = {
  question: "Open question",
  proposal: "Waiting for result",
  reply: "New reply",
};

export interface InboxSectionProps {
  /** Jump to the entry's item (its client, then its decision or project). */
  onOpen: (entry: InboxEntry) => void;
}

/**
 * PANT-960: one inbox across every client — open questions, proposals
 * waiting for a result, and threads with a new reply. Deliberately not
 * scoped by the header client switcher: it is the one place that shows all
 * clients at once, and each entry is labeled with its client and repo.
 * Opening an entry marks its thread seen (POST /api/inbox/seen).
 */
export function InboxSection({ onOpen }: InboxSectionProps) {
  const [items, setItems] = useState<InboxEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/inbox")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { items: InboxEntry[] }) => setItems(body.items ?? []))
      .catch((e) => setError((e as Error).message));
  }, []);

  function open(entry: InboxEntry) {
    void fetch("/api/inbox/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: entry.itemId }),
    }).catch(() => {
      // best-effort — failing to mark seen must never block navigation
    });
    onOpen(entry);
  }

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Inbox</h1>
        <p>Everything waiting on you, across every client — open questions, proposals waiting for a result, and new replies.</p>
      </div>

      {error ? <p className="state state--err">Could not load the inbox: {error}</p> : null}
      {!error && items === null ? <p className="state">Loading inbox…</p> : null}
      {items !== null && items.length === 0 ? (
        <div className="empty">
          <strong>Nothing waiting on you</strong>
          New questions, pending proposals and replies from every client show up here.
        </div>
      ) : null}
      {items !== null && items.length > 0 ? (
        <ul className="inbox-list" aria-label="Inbox">
          {items.map((entry) => (
            <li key={entry.key} className={`inbox-item inbox-item--${entry.kind}`}>
              <button type="button" className="inbox-item__open" onClick={() => open(entry)}>
                <span className="inbox-item__kind">{KIND_LABEL[entry.kind]}</span>
                <span className="inbox-item__title">{entry.title}</span>
                <span className="inbox-item__where">
                  {entry.client ?? "No client"} · {entry.repo ?? "no repo"}
                </span>
                {entry.detail ? <span className="inbox-item__detail">{entry.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
