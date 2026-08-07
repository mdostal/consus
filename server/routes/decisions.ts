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
  decision_payload: string;
}

/**
 * REQ-28: the "list open decisions" endpoint an agent-harness needs — every
 * item carrying a decision_payload that hasn't been decided yet (decided_at
 * IS NULL, same amnesia-fix rule REQ-08's decide flow already enforces).
 * `?all=1` drops the decided_at filter so a decided item — which a POST
 * verdict (POST /api/items/:id/decide) moves out of the default open queue —
 * is still reachable for audit/history views instead of vanishing.
 */
export function registerDecisionRoutes(app: FastifyInstance, { db }: DecisionRoutesOptions): void {
  app.get<{ Querystring: { all?: string } }>("/api/decisions", async (request) => {
    const includeDecided = request.query.all === "1";
    const sql = includeDecided
      ? "SELECT id, type, title, status, decision_payload FROM items WHERE decision_payload IS NOT NULL ORDER BY created_at ASC"
      : "SELECT id, type, title, status, decision_payload FROM items WHERE decision_payload IS NOT NULL AND decided_at IS NULL ORDER BY created_at ASC";
    const rows = db.prepare(sql).all() as ItemRow[];

    return rows.map((row) => ({
      ...row,
      decision_payload: JSON.parse(row.decision_payload),
    }));
  });
}
