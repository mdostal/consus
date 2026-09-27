import type Database from "better-sqlite3";
import { reportProposalResult } from "../proposals/store.js";

interface ChangeResult {
  status: "applied" | "failed";
  applied_diff?: string;
  reason?: string;
  at: string;
}

interface ChangeView {
  ticket_id: string;
  origin_item_ref: Record<string, unknown>;
  result: ChangeResult | null;
  updated_at: string;
}

/**
 * Polls Pantheon's feed for completed change tickets that originated from
 * Consus and calls reportProposalResult for each, transitioning proposals
 * from pending to applied|failed. Maintains an in-memory ISO timestamp
 * cursor so each poll fetches only new results.
 */
export class PantheonResultPuller {
  private cursor: string | undefined;

  constructor(
    private readonly pantheonApiUrl: string,
    private readonly db: Database.Database,
    /** Injectable for tests; resolved at call time so `vi.stubGlobal("fetch")`
     *  still works when omitted. */
    private readonly fetchImpl?: typeof globalThis.fetch,
  ) {}

  async poll(): Promise<void> {
    const url = new URL(`${this.pantheonApiUrl}/api/feed/changes`);
    url.searchParams.set("origin_god", "consus");
    url.searchParams.set("has_result", "true");
    if (this.cursor) url.searchParams.set("since", this.cursor);

    let changes: ChangeView[];
    try {
      const res = await (this.fetchImpl ?? globalThis.fetch)(url.toString());
      if (!res.ok) return;
      const data = (await res.json()) as { changes: ChangeView[] };
      changes = data.changes;
    } catch {
      return;
    }

    if (changes.length === 0) return;

    let latestAt = this.cursor;
    for (const change of changes) {
      const { origin_item_ref: itemRef, result } = change;
      if (!result) continue;
      const proposalId = itemRef.proposalId;
      if (typeof proposalId !== "string") continue;

      await reportProposalResult(this.db, {
        proposalId,
        status: result.status,
        appliedDiff: result.applied_diff,
        reason: result.reason,
      });

      if (!latestAt || change.updated_at > latestAt) {
        latestAt = change.updated_at;
      }
    }
    this.cursor = latestAt;
  }

  start(intervalMs: number): ReturnType<typeof setInterval> {
    // Fetch errors are swallowed inside poll(), but reportProposalResult can
    // still reject — catch here so a bad row never becomes an unhandled
    // rejection that takes the server down.
    return setInterval(() => {
      this.poll().catch((err) => console.error("[result-puller] poll failed", err));
    }, intervalMs);
  }
}
