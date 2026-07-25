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
 */
export function registerDecisionRoutes(app: FastifyInstance, { db }: DecisionRoutesOptions): void {
  app.get("/api/decisions", async () => {
    const rows = db
      .prepare(
        "SELECT id, type, title, status, decision_payload FROM items WHERE decision_payload IS NOT NULL AND decided_at IS NULL ORDER BY created_at ASC",
      )
      .all() as ItemRow[];

    return rows.map((row) => ({
      ...row,
      decision_payload: JSON.parse(row.decision_payload),
    }));
  });
}
