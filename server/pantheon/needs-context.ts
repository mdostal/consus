import type Database from "better-sqlite3";
import { recordSyncFailure, recordSyncSuccess, safeRecord } from "./sync-status.js";

/**
 * PANT-938: warn-only readiness. A decision created with no supporting
 * material is never blocked or hidden; instead Consus asks Pantheon (once) for
 * someone to fill the context in, via `decision:needs-context`. Pantheon's
 * receiver lands in a later pantheon-v2 story; until then the call 404s and is
 * recorded as a `needs_context_push` sync failure.
 */

/** Every kind of material a decision can carry — all of it is missing when the count is 0. */
export const NEEDS_CONTEXT_MISSING = ["research", "attachments", "doc"] as const;

/**
 * Supporting material that lives in the decision_payload itself: a research
 * section counts when it cites at least one source, and a `doc` pointer counts
 * once. Attachments and artifact links are counted in SQL
 * (SUPPORTING_MATERIAL_COUNT_SQL in server/routes/decisions.ts); the two add up
 * to `supporting_material_count`.
 */
export function nativeContextCount(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const p = payload as { research?: unknown; doc?: unknown };
  let n = 0;
  if (Array.isArray(p.research)) {
    n += p.research.filter(
      (section) =>
        !!section &&
        typeof section === "object" &&
        Array.isArray((section as { sources?: unknown }).sources) &&
        (section as { sources: unknown[] }).sources.some((s) => typeof s === "string" && s.trim() !== ""),
    ).length;
  }
  const doc = p.doc as { repo?: unknown; path?: unknown } | undefined;
  if (doc && typeof doc === "object" && typeof doc.repo === "string" && doc.repo && typeof doc.path === "string" && doc.path) {
    n += 1;
  }
  return n;
}

export interface NeedsContextOptions {
  pantheonApiUrl: string;
  fetch: typeof globalThis.fetch;
}

/**
 * Sends `decision:needs-context` for one item, at most once ever: the item's
 * `needs_context_requested_at` is claimed before the POST, so a repeat call (or
 * a failed delivery) never resends — there is no retry loop or timer. Returns
 * the claimed timestamp, or null when the item was already requested (or
 * doesn't exist). The POST itself is fire-and-forget; its outcome only lands
 * in sync_status.
 */
export function requestNeedsContext(
  db: Database.Database,
  itemId: string,
  { pantheonApiUrl, fetch: doFetch }: NeedsContextOptions,
  at = new Date(),
): string | null {
  const requestedAt = at.toISOString();
  const claimed = db
    .prepare("UPDATE items SET needs_context_requested_at = ? WHERE id = ? AND needs_context_requested_at IS NULL")
    .run(requestedAt, itemId);
  if (claimed.changes !== 1) return null;

  const item = db.prepare("SELECT id, title, survey_id, source_repo FROM items WHERE id = ?").get(itemId) as {
    id: string;
    title: string;
    survey_id: string | null;
    source_repo: string | null;
  };

  doFetch(`${pantheonApiUrl}/api/events/decisions/needs-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decision_id: item.id,
      survey_id: item.survey_id,
      title: item.title,
      source_repo: item.source_repo,
      missing: [...NEEDS_CONTEXT_MISSING],
    }),
  })
    .then((res) => {
      safeRecord(() =>
        res.ok
          ? recordSyncSuccess(db, "needs_context_push")
          : recordSyncFailure(db, "needs_context_push", `Pantheon needs-context event failed: ${res.status}`),
      );
    })
    .catch((err: unknown) => {
      console.error("[needs-context] event call failed", err);
      safeRecord(() => recordSyncFailure(db, "needs_context_push", err));
    });

  return requestedAt;
}
