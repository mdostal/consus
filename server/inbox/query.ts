import type Database from "better-sqlite3";
import type { ProjectClients } from "../clients/store.js";

/**
 * PANT-960: one inbox across every client — what is waiting on the operator,
 * wherever it lives:
 *  - question: an undecided, unclosed decision item
 *  - proposal: a proposal still waiting for its harness result (pending)
 *  - reply:    an item whose newest comment arrived after the operator last
 *              opened it (inbox_seen), or that was never opened
 * Each entry carries its repo and that repo's client so the UI can label it
 * and jump there.
 */
export type InboxKind = "question" | "proposal" | "reply";

export interface InboxItem {
  kind: InboxKind;
  /** Stable per-entry key (`<kind>:<id>`). */
  key: string;
  itemId: string;
  itemType: string;
  /** Whether the item is a decision (opens in Decisions) or not (opens its project). */
  isDecision: boolean;
  title: string;
  repo: string | null;
  client: string | null;
  /** When it entered the inbox (ISO-8601): question created, proposal requested, reply posted. */
  at: string;
  /** Short extra context: the proposal description or the reply's author + body. */
  detail: string | null;
  proposalId?: string;
}

export interface InboxQuery {
  /** Registered project -> client (getProjectClients). */
  clients: ProjectClients;
  /** Only entries whose repo belongs to this client. Omitted = all clients. */
  client?: string;
}

interface ItemRow {
  id: string;
  type: string;
  title: string;
  source_repo: string | null;
  is_decision: number;
}

const DETAIL_MAX = 140;

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > DETAIL_MAX ? `${oneLine.slice(0, DETAIL_MAX - 1)}…` : oneLine;
}

export function listInbox(db: Database.Database, { clients, client }: InboxQuery): InboxItem[] {
  const base = (row: ItemRow) => ({
    itemId: row.id,
    itemType: row.type,
    isDecision: row.is_decision === 1,
    title: row.title,
    repo: row.source_repo,
    client: row.source_repo ? (clients[row.source_repo] ?? null) : null,
  });

  const questions = db
    .prepare(
      `SELECT id, type, title, source_repo, 1 AS is_decision, created_at
       FROM items
       WHERE decision_payload IS NOT NULL AND decided_at IS NULL AND status != 'closed'`,
    )
    .all() as Array<ItemRow & { created_at: string }>;

  const proposals = db
    .prepare(
      `SELECT p.id AS proposal_id, p.description, p.requested_at,
              i.id, i.type, i.title, i.source_repo, (i.decision_payload IS NOT NULL) AS is_decision
       FROM proposals p JOIN items i ON i.id = p.item_id
       WHERE p.status = 'pending'`,
    )
    .all() as Array<ItemRow & { proposal_id: string; description: string; requested_at: string }>;

  // The newest comment per item (highest id), kept only when it is newer
  // than the item's seen mark.
  const replies = db
    .prepare(
      `SELECT i.id, i.type, i.title, i.source_repo, (i.decision_payload IS NOT NULL) AS is_decision,
              c.author, c.body, c.created_at
       FROM comments c
       JOIN items i ON i.id = c.item_id
       LEFT JOIN inbox_seen s ON s.item_id = c.item_id
       WHERE c.id = (SELECT MAX(id) FROM comments WHERE item_id = c.item_id)
         AND (s.seen_at IS NULL OR c.created_at > s.seen_at)`,
    )
    .all() as Array<ItemRow & { author: string; body: string; created_at: string }>;

  const entries: InboxItem[] = [
    ...questions.map((row) => ({
      kind: "question" as const,
      key: `question:${row.id}`,
      ...base(row),
      at: row.created_at,
      detail: null,
    })),
    ...proposals.map((row) => ({
      kind: "proposal" as const,
      key: `proposal:${row.proposal_id}`,
      ...base(row),
      at: row.requested_at,
      detail: clip(row.description),
      proposalId: row.proposal_id,
    })),
    ...replies.map((row) => ({
      kind: "reply" as const,
      key: `reply:${row.id}`,
      ...base(row),
      at: row.created_at,
      detail: clip(`${row.author}: ${row.body}`),
    })),
  ];

  return entries
    .filter((entry) => client === undefined || entry.client === client)
    .sort((a, b) => (a.at === b.at ? a.key.localeCompare(b.key) : b.at.localeCompare(a.at)));
}

/** Records that the operator has seen an item's thread up to now, clearing
 *  its reply entry until a newer comment arrives. */
export function markInboxSeen(db: Database.Database, itemId: string, at = new Date().toISOString()): void {
  db.prepare(
    `INSERT INTO inbox_seen (item_id, seen_at) VALUES (?, ?)
     ON CONFLICT(item_id) DO UPDATE SET seen_at = MAX(inbox_seen.seen_at, excluded.seen_at)`,
  ).run(itemId, at);
}
