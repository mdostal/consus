import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { HarnessTransport } from "../harness/transport.js";

/**
 * The propose-a-change-and-fire-to-harness mechanism. Consus never writes
 * the underlying .pHive/repo content directly — it composes a change
 * proposal (diff + description) and fires it to a generic HarnessTransport
 * (server/harness/transport.ts) — no specific system name or SDK, just a
 * `proposeChange` method call. The harness applies the real change and
 * reports back via reportProposalResult, which is what transitions status
 * out of 'pending' and — on success — writes the audit_log entry.
 *
 * Deliberately generic: works identically for a decision, a diagram, or a
 * doc — targetType is a label carried on the row, never branched on here.
 */

export type ProposalStatus = "pending" | "applied" | "failed";

export interface ProposalRow {
  id: string;
  item_id: string;
  target_type: string;
  diff: string;
  description: string;
  status: ProposalStatus;
  requested_by: string;
  requested_at: string;
  resolved_at: string | null;
  applied_diff: string | null;
  failure_reason: string | null;
  harness_ticket_id: string | null;
}

export interface ProposeChangeInput {
  itemId: string;
  targetType: string;
  diff: string;
  description: string;
  requestedBy: string;
}

export type ProposeChangeResult = { ok: true; proposalId: string } | { ok: false; error: string };

export async function proposeChange(
  db: Database.Database,
  transport: HarnessTransport,
  { itemId, targetType, diff, description, requestedBy }: ProposeChangeInput,
): Promise<ProposeChangeResult> {
  const item = db.prepare("SELECT id, source_repo FROM items WHERE id = ?").get(itemId) as { id: string; source_repo: string | null } | undefined;
  if (!item) {
    return { ok: false, error: `target item not found: ${itemId}` };
  }

  const proposalId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO proposals (id, item_id, target_type, diff, description, status, requested_by, requested_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(proposalId, itemId, targetType, diff, description, requestedBy, now);

  const dispatched = await transport.invoke("proposeChange", { proposalId, itemId, targetType, diff, description, sourceRepo: item.source_repo });

  // A dispatch failure (the harness never received the proposal at all) is
  // resolved immediately, not left pending — "no stuck states" per this
  // story's acceptance criteria. A later, harness-reported outcome comes
  // through reportProposalResult instead, once dispatch itself succeeded.
  if (!dispatched.ok) {
    const reason = dispatched.message ? `${dispatched.code}: ${dispatched.message}` : dispatched.code;
    db.prepare(
      "UPDATE proposals SET status = 'failed', resolved_at = ?, failure_reason = ? WHERE id = ?",
    ).run(new Date().toISOString(), reason, proposalId);
  } else {
    const ticketId = (dispatched.result as { ticket_id?: string } | null | undefined)?.ticket_id;
    if (ticketId) {
      db.prepare("UPDATE proposals SET harness_ticket_id = ? WHERE id = ?").run(ticketId, proposalId);
    }
  }

  return { ok: true, proposalId };
}

export interface ReportProposalResultInput {
  proposalId: string;
  status: "applied" | "failed";
  /** The actual applied diff, when status is 'applied'. Falls back to the
   *  originally proposed diff if the harness doesn't echo one back. */
  appliedDiff?: string;
  /** Failure reason, when status is 'failed'. */
  reason?: string;
}

/**
 * `alreadyResolved` is set when the proposal was already resolved with the
 * same status — a harness retry or a puller replay — and nothing was
 * written. `code: "conflict"` means the proposal was already resolved with
 * the opposite status; the row is left untouched.
 */
export type ReportProposalResultResult =
  | { ok: true; alreadyResolved?: true }
  | { ok: false; code: "not_found" | "conflict"; error: string };

export async function reportProposalResult(
  db: Database.Database,
  { proposalId, status, appliedDiff, reason }: ReportProposalResultInput,
): Promise<ReportProposalResultResult> {
  // Read-check-write inside one transaction, and the UPDATE is guarded on
  // status = 'pending', so only the first result for a proposal ever lands —
  // retries and replays can't add a second audit_log row, move resolved_at,
  // or flip applied <-> failed.
  const tx = db.transaction((): ReportProposalResultResult => {
    const proposal = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId) as ProposalRow | undefined;
    if (!proposal) {
      return { ok: false, code: "not_found", error: `proposal not found: ${proposalId}` };
    }

    if (proposal.status !== "pending") {
      if (proposal.status === status) {
        return { ok: true, alreadyResolved: true };
      }
      return {
        ok: false,
        code: "conflict",
        error: `proposal ${proposalId} is already ${proposal.status}; cannot report ${status}`,
      };
    }

    const now = new Date().toISOString();

    if (status === "applied") {
      const finalDiff = appliedDiff ?? proposal.diff;
      db.prepare(
        "UPDATE proposals SET status = 'applied', resolved_at = ?, applied_diff = ? WHERE id = ? AND status = 'pending'",
      ).run(now, finalDiff, proposalId);

      db.prepare(
        "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(proposal.item_id, proposal.requested_by, `proposal:${proposal.target_type}`, null, finalDiff, now);
    } else {
      db.prepare(
        "UPDATE proposals SET status = 'failed', resolved_at = ?, failure_reason = ? WHERE id = ? AND status = 'pending'",
      ).run(now, reason ?? "unknown", proposalId);
    }

    return { ok: true };
  });

  return tx.immediate();
}

export function listProposals(db: Database.Database, itemId: string): ProposalRow[] {
  // rowid tiebreaker — requested_at can collide at ISO-millisecond
  // resolution when proposals fire in quick succession.
  return db
    .prepare("SELECT * FROM proposals WHERE item_id = ? ORDER BY requested_at DESC, rowid DESC")
    .all(itemId) as ProposalRow[];
}
