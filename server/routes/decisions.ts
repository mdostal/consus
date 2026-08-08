import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { syncMulticaQueue } from "../adapters/multica/ingest.js";
import type { MulticaClient } from "../adapters/multica/client.js";

export interface DecisionRoutesOptions {
  db: Database.Database;
  client: MulticaClient;
}

interface ItemRow {
  id: string;
  type: string;
  title: string;
  status: string;
  decision_payload: string | null;
  decision_type: string | null;
  triage_bucket: string | null;
}

/**
 * REQ-28 + [wire-decisions-endpoint]: the "list open decisions" endpoint an
 * agent-harness needs. Every GET first syncs the live Multica feed (fetch +
 * classify, see adapters/multica/ingest.ts) so freshly filed/updated Multica
 * issues are reflected before the query runs, then lists every item that is
 * either a locally-authored decision_payload item (REQ-11/REQ-01 human
 * requests) or a classified Multica issue, excluding already-decided items
 * (decided_at IS NULL, the REQ-08 amnesia-fix rule). `?all=1` drops the
 * decided_at filter so a decided item — which a POST verdict
 * (POST /api/items/:id/decide) moves out of the default open queue — is
 * still reachable for audit/history views instead of vanishing.
 */
export function registerDecisionRoutes(app: FastifyInstance, { db, client }: DecisionRoutesOptions): void {
  app.get<{ Querystring: { all?: string } }>("/api/decisions", async (request, reply) => {
    const synced = await syncMulticaQueue(db, client);
    if (!synced.ok) {
      reply.code(503);
      return { error: `Multica fetch failed: ${synced.error}` };
    }

    const includeDecided = request.query.all === "1";
    const isDecisionItem = "(decision_payload IS NOT NULL OR id LIKE 'multica:%')";
    const sql = includeDecided
      ? `SELECT id, type, title, status, decision_payload, decision_type, triage_bucket FROM items WHERE ${isDecisionItem} ORDER BY created_at ASC`
      : `SELECT id, type, title, status, decision_payload, decision_type, triage_bucket FROM items WHERE ${isDecisionItem} AND decided_at IS NULL ORDER BY created_at ASC`;
    const rows = db.prepare(sql).all() as ItemRow[];

    return rows.map((row) => ({
      ...row,
      decision_payload: row.decision_payload ? JSON.parse(row.decision_payload) : null,
    }));
  });
}
