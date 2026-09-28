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

/** Row key in harness_cursors (server/db/migrate.ts). */
const CURSOR_NAME = "pantheon-result-puller";

/**
 * Polls Pantheon's feed for completed change tickets that originated from
 * Consus and calls reportProposalResult for each, transitioning proposals
 * from pending to applied|failed. Keeps an ISO timestamp cursor in the
 * harness_cursors table so each poll — including the first one after a
 * restart — fetches only new results. Replays that do slip through are
 * harmless: reportProposalResult is idempotent.
 */
export class PantheonResultPuller {
  private cursor: string | undefined;
  private cursorLoaded = false;

  constructor(
    private readonly pantheonApiUrl: string,
    private readonly db: Database.Database,
    /** Injectable for tests; resolved at call time so `vi.stubGlobal("fetch")`
     *  still works when omitted. */
    private readonly fetchImpl?: typeof globalThis.fetch,
  ) {}

  private loadCursor(): string | undefined {
    if (!this.cursorLoaded) {
      const row = this.db.prepare("SELECT cursor FROM harness_cursors WHERE name = ?").get(CURSOR_NAME) as
        | { cursor: string }
        | undefined;
      this.cursor = row?.cursor;
      this.cursorLoaded = true;
    }
    return this.cursor;
  }

  private saveCursor(cursor: string): void {
    this.db
      .prepare(
        `INSERT INTO harness_cursors (name, cursor, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
      )
      .run(CURSOR_NAME, cursor, new Date().toISOString());
    this.cursor = cursor;
  }

  async poll(): Promise<void> {
    this.loadCursor();
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
    if (latestAt && latestAt !== this.cursor) this.saveCursor(latestAt);
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
