import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

/**
 * A pre-decision review-queue item — deliberately a separate table and
 * status enum from proposals (server/proposals/store.ts). A proposals row
 * always represents an attempted harness dispatch; an event may never
 * become a proposal at all. See docs/design-discussion.md, "Event data
 * model" and "Retention — RESOLVED: archival history".
 *
 * Same style as server/proposals/store.ts: snake_case row shape,
 * randomUUID() ids, new Date().toISOString() timestamps, db.prepare(...)
 * called directly per function, no ORM. This module stays a thin, honest
 * wrapper over the table — it persists whatever it's given and does not
 * validate trigger-kind-specific field combinations (that's p14-2's job).
 */

export type EventTriggerKind = "doc_changed" | "decision_needed";
export type EventStatus = "new" | "in_progress" | "done" | "dismissed";

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

export interface CreateEventInput {
  project: string;
  triggerKind: EventTriggerKind;
  sourceRepo: string;
  sourcePath: string;
  contentHash: string;
  previousHash?: string | null;
  diff?: string | null;
  itemId?: string | null;
  composedPrompt: string;
}

export function createEvent(db: Database.Database, input: CreateEventInput): EventRow {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO events (
       id, project, trigger_kind, source_repo, source_path, content_hash,
       previous_hash, diff, item_id, composed_prompt, status, detected_at, status_updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
  ).run(
    id,
    input.project,
    input.triggerKind,
    input.sourceRepo,
    input.sourcePath,
    input.contentHash,
    input.previousHash ?? null,
    input.diff ?? null,
    input.itemId ?? null,
    input.composedPrompt,
    now,
    now,
  );

  return getEvent(db, id) as EventRow;
}

// The only safe way to accept a caller-influenced column/direction name in
// a hand-written SQL string: an allow-list lookup, never string
// interpolation of the raw value (SQL can't parameterize column/direction
// names with `?`).
const SORT_COLUMNS = {
  detected_at: "detected_at",
  status: "status",
  project: "project",
} as const;

const SORT_ORDERS = {
  asc: "ASC",
  desc: "DESC",
} as const;

export interface ListEventsFilters {
  project?: string;
  status?: EventStatus;
  sort?: keyof typeof SORT_COLUMNS;
  order?: keyof typeof SORT_ORDERS;
  /** false (default) excludes archived rows (archived_at IS NULL); true
   *  returns only archived rows (archived_at IS NOT NULL) — the p14-3
   *  history route's backing query. */
  archived?: boolean;
}

export function listEvents(db: Database.Database, filters: ListEventsFilters = {}): EventRow[] {
  const { project, status, sort = "detected_at", order = "desc", archived = false } = filters;

  const sortColumn = SORT_COLUMNS[sort];
  const sortOrder = SORT_ORDERS[order];
  if (!sortColumn || !sortOrder) {
    throw new Error(`invalid sort/order: ${sort}/${order}`);
  }

  const conditions: string[] = [archived ? "archived_at IS NOT NULL" : "archived_at IS NULL"];
  const params: unknown[] = [];

  if (project !== undefined) {
    conditions.push("project = ?");
    params.push(project);
  }
  if (status !== undefined) {
    conditions.push("status = ?");
    params.push(status);
  }

  const sql = `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY ${sortColumn} ${sortOrder}`;

  return db.prepare(sql).all(...params) as EventRow[];
}

export function updateEventStatus(
  db: Database.Database,
  id: string,
  status: EventStatus,
): EventRow | null {
  const existing = getEvent(db, id);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const archivedAt =
    status === "done" || status === "dismissed" ? existing.archived_at ?? now : null;

  db.prepare(
    "UPDATE events SET status = ?, status_updated_at = ?, archived_at = ? WHERE id = ?",
  ).run(status, now, archivedAt, id);

  return getEvent(db, id) as EventRow;
}

export function getEvent(db: Database.Database, id: string): EventRow | undefined {
  return db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
}

/** p14-3's final write in the "graduate an event into a proposal" flow —
 *  records the newly created proposal's id back onto the event row. Direct,
 *  single-purpose write; no other field changes (status transitions are a
 *  separate, independently-triggered call — see updateEventStatus). */
export function setEventProposalId(db: Database.Database, id: string, proposalId: string): EventRow | null {
  const existing = getEvent(db, id);
  if (!existing) {
    return null;
  }

  db.prepare("UPDATE events SET proposal_id = ? WHERE id = ?").run(proposalId, id);

  return getEvent(db, id) as EventRow;
}
