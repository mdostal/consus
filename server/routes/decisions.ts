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
  source_body: string | null;
  decided_at: string | null;
  decision_payload: string | null;
  decision_type: string | null;
  triage_bucket: string | null;
}

/**
 * REQ-28: the "list decisions" endpoint an agent-harness (and the Consus
 * web shell) needs — purely local. Consus has no live external data source;
 * items land in the `items` table via the KB store or the propose-a-change
 * mechanism, not a background sync.
 *
 * By default returns only the *open* queue — every item carrying a
 * decision_payload that hasn't been decided yet (decided_at IS NULL, the
 * same amnesia-fix rule REQ-08's decide flow enforces so decided items
 * never resurface).
 *
 * `?all=1` additionally returns already-decided items (decided_at NOT NULL) so
 * the shell can present a "Decided" section that stays reviewable.
 */
export function registerDecisionRoutes(app: FastifyInstance, { db }: DecisionRoutesOptions): void {
  app.get<{ Querystring: { all?: string } }>("/api/decisions", async (request) => {
    const includeDecided = request.query?.all === "1" || request.query?.all === "true";

    const sql = includeDecided
      ? "SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket FROM items WHERE decision_payload IS NOT NULL ORDER BY (decided_at IS NULL) DESC, updated_at DESC, created_at ASC"
      : "SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket FROM items WHERE decision_payload IS NOT NULL AND decided_at IS NULL ORDER BY created_at ASC";

    const rows = db.prepare(sql).all() as ItemRow[];

    return rows.map((row) => ({
      ...row,
      decision_payload: row.decision_payload ? JSON.parse(row.decision_payload) : null,
    }));
  });
}
