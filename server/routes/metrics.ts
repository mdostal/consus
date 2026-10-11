import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { getSyncStatus, isFailing, SYNC_DIRECTIONS, type SyncStatusRow } from "../pantheon/sync-status.js";

export interface MetricsRoutesOptions {
  db: Database.Database;
  /** Registered projects (name -> path) — listed even before their first ingest. */
  repos: Record<string, string>;
  /** Active harness transport name (see transportName() in server/harness/transport.ts). */
  transport: string;
  /** True when the Pantheon pushes (server/pantheon/) are configured; adds the `pantheon` sync block. */
  pantheonPush?: boolean;
  /** Injectable clock so age fields are deterministic in tests. */
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ageSeconds(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 1000));
}

function count(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function oldest(db: Database.Database, sql: string): string | null {
  return (db.prepare(sql).get() as { at: string | null }).at;
}

/** Pantheon sync block for GET /api/metrics — every known direction, even ones never attempted. */
export function pantheonSyncMetrics(db: Database.Database, at: Date = new Date()) {
  const rows = new Map(getSyncStatus(db).map((r) => [r.direction, r]));
  const directions = Object.fromEntries(
    SYNC_DIRECTIONS.map((d) => {
      const row: SyncStatusRow = rows.get(d) ?? { direction: d, last_success_at: null, last_failure_at: null, last_error: null };
      return [
        d,
        {
          last_success_at: row.last_success_at,
          last_failure_at: row.last_failure_at,
          last_error: row.last_error,
          failing: isFailing(row),
        },
      ];
    }),
  );

  const latestFailure = [...rows.values()]
    .filter((r) => r.last_failure_at)
    .sort((a, b) => b.last_failure_at!.localeCompare(a.last_failure_at!))[0];

  return {
    degraded: [...rows.values()].some(isFailing),
    last_error: latestFailure?.last_error ?? null,
    last_error_at: latestFailure?.last_failure_at ?? null,
    last_error_direction: latestFailure?.direction ?? null,
    directions,
    // PANT-807 question-answer outbox: answers not yet accepted by Pantheon.
    undelivered_answers: {
      pending: count(db, "SELECT COUNT(*) AS n FROM question_deliveries WHERE status = 'pending'"),
      failed: count(db, "SELECT COUNT(*) AS n FROM question_deliveries WHERE status = 'failed'"),
      oldest_age_seconds: ageSeconds(
        oldest(db, "SELECT MIN(created_at) AS at FROM question_deliveries WHERE status != 'delivered'"),
        at,
      ),
    },
  };
}

/**
 * PANT-809: operability snapshot for Janus / Pantheon dashboards. Computed
 * from SQLite on every request — no background work, no caching.
 */
export function registerMetricsRoutes(app: FastifyInstance, { db, repos, transport, pantheonPush = false, now = () => new Date() }: MetricsRoutesOptions): void {
  app.get("/api/metrics", async () => {
    const at = now();
    const dayAgo = new Date(at.getTime() - DAY_MS).toISOString();

    // Same "open" definition as GET /api/decisions's default queue.
    const openWhere = "decision_payload IS NOT NULL AND decided_at IS NULL";

    const ingests = new Map(
      (db.prepare("SELECT repo, last_ingest_at FROM project_ingests").all() as Array<{ repo: string; last_ingest_at: string }>).map(
        (r) => [r.repo, r.last_ingest_at],
      ),
    );
    const docCounts = new Map(
      (db.prepare("SELECT repo, COUNT(*) AS n FROM doc_index GROUP BY repo").all() as Array<{ repo: string; n: number }>).map(
        (r) => [r.repo, r.n],
      ),
    );
    const projectNames = [...new Set([...Object.keys(repos), ...ingests.keys(), ...docCounts.keys()])].sort();

    return {
      generated_at: at.toISOString(),
      decisions: {
        open: count(db, `SELECT COUNT(*) AS n FROM items WHERE ${openWhere}`),
        oldest_open_age_seconds: ageSeconds(oldest(db, `SELECT MIN(created_at) AS at FROM items WHERE ${openWhere}`), at),
      },
      proposals: {
        pending: count(db, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'"),
        oldest_pending_age_seconds: ageSeconds(
          oldest(db, "SELECT MIN(requested_at) AS at FROM proposals WHERE status = 'pending'"),
          at,
        ),
        failed_24h: count(db, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'failed' AND resolved_at >= ?", dayAgo),
        applied_24h: count(db, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'applied' AND resolved_at >= ?", dayAgo),
      },
      events: {
        pending: count(db, "SELECT COUNT(*) AS n FROM events WHERE status = 'new'"),
        in_review: count(db, "SELECT COUNT(*) AS n FROM events WHERE status = 'in_progress'"),
      },
      projects: projectNames.map((name) => ({
        name,
        last_ingest_at: ingests.get(name) ?? null,
        doc_count: docCounts.get(name) ?? 0,
      })),
      harness: { transport },
      ...(pantheonPush ? { pantheon: pantheonSyncMetrics(db, at) } : {}),
    };
  });
}
