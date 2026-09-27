import type Database from "better-sqlite3";

/**
 * PANT-809: last success / last failure per Pantheon sync direction, kept in
 * the `sync_status` table (server/db/migrate.ts) so `GET /api/metrics` and
 * `/health`'s `degraded` flag survive a restart. Before this, a Pantheon-mode
 * failure only ever surfaced as a `console.error`.
 *
 *  - question_pull: PantheonQuestionPuller — GET /api/feed/questions
 *  - result_pull:   PantheonResultPuller   — GET /api/feed/changes
 *  - question_push: postQuestionVerdict    — POST /api/feed/questions/:ticket/{partial,submit}
 *  - decision_push: verdict bridge         — POST /api/events/decisions
 */
export const SYNC_DIRECTIONS = ["question_pull", "result_pull", "question_push", "decision_push"] as const;
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number];

export interface SyncStatusRow {
  direction: SyncDirection;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
}

export function recordSyncSuccess(db: Database.Database, direction: SyncDirection, at = new Date()): void {
  db.prepare(
    `INSERT INTO sync_status (direction, last_success_at) VALUES (?, ?)
     ON CONFLICT(direction) DO UPDATE SET last_success_at = excluded.last_success_at`,
  ).run(direction, at.toISOString());
}

export function recordSyncFailure(
  db: Database.Database,
  direction: SyncDirection,
  error: unknown,
  at = new Date(),
): void {
  const message = error instanceof Error ? error.message : String(error);
  db.prepare(
    `INSERT INTO sync_status (direction, last_failure_at, last_error) VALUES (?, ?, ?)
     ON CONFLICT(direction) DO UPDATE SET last_failure_at = excluded.last_failure_at, last_error = excluded.last_error`,
  ).run(direction, at.toISOString(), message);
}

/** Never lets a status write (e.g. a handle closed mid-poll) break the sync path it observes. */
export function safeRecord(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error("[sync-status] record failed", err);
  }
}

export function getSyncStatus(db: Database.Database): SyncStatusRow[] {
  return db
    .prepare("SELECT direction, last_success_at, last_failure_at, last_error FROM sync_status ORDER BY direction")
    .all() as SyncStatusRow[];
}

/** A direction is failing when its last failure is newer than its last success. */
export function isFailing(row: SyncStatusRow): boolean {
  if (!row.last_failure_at) return false;
  return !row.last_success_at || row.last_failure_at > row.last_success_at;
}

export function isSyncDegraded(db: Database.Database): boolean {
  return getSyncStatus(db).some(isFailing);
}
