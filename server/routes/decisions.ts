import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { resolveMulticaProjectId, type MulticaClient } from "../adapters/multica/client.js";
import { syncMulticaQueue } from "../adapters/multica/ingest.js";

export interface DecisionRoutesOptions {
  db: Database.Database;
  client: MulticaClient;
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
 * REQ-28 + s1-multica-live-ingest: the "list decisions" endpoint an
 * agent-harness (and the Consus web shell) needs. Syncs live Multica issues
 * into the store on every request (s1) before reading — this is what turns
 * an otherwise-empty local queue into real, current data.
 *
 * By default returns only the *open* queue — every item carrying a
 * decision_payload, or ingested from Multica, that hasn't been decided yet
 * (decided_at IS NULL, the same amnesia-fix rule REQ-08's decide flow
 * enforces so decided items never resurface). A raw Multica issue with no
 * decision-request/v1 block still has a decision_type/triage_bucket from the
 * heuristic classifier and is included — the queue would otherwise show
 * almost nothing, since most real tickets don't carry the fenced block.
 *
 * `?all=1` additionally returns already-decided items (decided_at NOT NULL) so
 * the shell can present a "Decided" section that stays reviewable.
 */
export function registerDecisionRoutes(app: FastifyInstance, { db, client }: DecisionRoutesOptions): void {
  app.get<{ Querystring: { all?: string } }>("/api/decisions", async (request, reply) => {
    const synced = await syncMulticaQueue(db, client, { project: resolveMulticaProjectId() });
    if (!synced.ok) {
      reply.code(503);
      return { error: `Multica sync failed: ${synced.error}` };
    }

    const includeDecided = request.query?.all === "1" || request.query?.all === "true";
    const isDecisionItem = "(decision_payload IS NOT NULL OR id LIKE 'multica:%')";

    const sql = includeDecided
      ? `SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket FROM items WHERE ${isDecisionItem} ORDER BY (decided_at IS NULL) DESC, updated_at DESC, created_at ASC`
      : `SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket FROM items WHERE ${isDecisionItem} AND decided_at IS NULL ORDER BY created_at ASC`;

    const rows = db.prepare(sql).all() as ItemRow[];

    return rows.map((row) => ({
      ...row,
      decision_payload: row.decision_payload ? JSON.parse(row.decision_payload) : null,
    }));
  });
}
