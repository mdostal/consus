import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export interface DecisionRoutesOptions {
  db: Database.Database;
}

interface ItemRow {
  id: string;
  type: string;
  title: string;
  status: string;
  source_repo: string | null;
  decided_at: string | null;
  decision_payload: string;
}

/**
 * REQ-28: the "list decisions" endpoint an agent-harness (and the Consus web
 * shell) needs.
 *
 * By default returns only the *open* queue — every item carrying a
 * decision_payload that hasn't been decided yet (decided_at IS NULL, the same
 * amnesia-fix rule REQ-08's decide flow enforces so decided items never
 * resurface).
 *
 * `?all=1` additionally returns already-decided items (decided_at NOT NULL) so
 * the shell can present a "Decided" section that stays reviewable — the
 * operator can re-open the thread, read the recorded verdict, comment, or
 * revise. `decided_at` and `source_repo` are included so the caller can group
 * by open/decided and by project without a second query.
 */
export function registerDecisionRoutes(app: FastifyInstance, { db }: DecisionRoutesOptions): void {
  app.get<{ Querystring: { all?: string } }>("/api/decisions", async (request) => {
    const includeDecided = request.query?.all === "1" || request.query?.all === "true";

    const sql = includeDecided
      ? "SELECT id, type, title, status, source_repo, decided_at, decision_payload FROM items WHERE decision_payload IS NOT NULL ORDER BY (decided_at IS NULL) DESC, updated_at DESC, created_at ASC"
      : "SELECT id, type, title, status, source_repo, decided_at, decision_payload FROM items WHERE decision_payload IS NOT NULL AND decided_at IS NULL ORDER BY created_at ASC";

    const rows = db.prepare(sql).all() as ItemRow[];

    return rows.map((row) => ({
      ...row,
      decision_payload: JSON.parse(row.decision_payload),
    }));
  });
}
