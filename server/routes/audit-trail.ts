import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { getAuditLog } from "../kb/store.js";
import { listProposals } from "../proposals/store.js";

export interface AuditTrailRoutesOptions {
  db: Database.Database;
}

type AuditTrailEntry =
  | {
      kind: "audit";
      id: number;
      actor: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      timestamp: string;
    }
  | {
      kind: "proposal";
      id: string;
      target_type: string;
      description: string;
      status: string;
      requested_by: string;
      timestamp: string;
      applied_diff: string | null;
      failure_reason: string | null;
    };

/**
 * s5: the shared audit panel's data source. One route for every item type
 * (decision, diagram, doc) — no branching here, the item id namespace
 * already carries the type. Merges plain audit_log entries (accept/mix/
 * reject verdicts, KB decides) with proposals (s3, any status), each
 * tagged with `kind` so the UI can distinguish them without guessing from
 * shape alone.
 */
export function registerAuditTrailRoutes(app: FastifyInstance, { db }: AuditTrailRoutesOptions): void {
  app.get<{ Params: { id: string } }>("/api/items/:id/audit-trail", async (request) => {
    const { id } = request.params;

    const auditEntries: AuditTrailEntry[] = getAuditLog(db, id).map((row) => ({
      kind: "audit",
      id: row.id,
      actor: row.actor,
      field: row.field,
      old_value: row.old_value,
      new_value: row.new_value,
      timestamp: row.timestamp,
    }));

    const proposalEntries: AuditTrailEntry[] = listProposals(db, id).map((row) => ({
      kind: "proposal",
      id: row.id,
      target_type: row.target_type,
      description: row.description,
      status: row.status,
      requested_by: row.requested_by,
      timestamp: row.requested_at,
      applied_diff: row.applied_diff,
      failure_reason: row.failure_reason,
    }));

    return [...auditEntries, ...proposalEntries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  });
}
