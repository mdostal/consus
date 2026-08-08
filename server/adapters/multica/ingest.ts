import type Database from "better-sqlite3";
import { classifyItem, type DecisionType, type TriageBucket } from "../../decision-contract/classifier.js";
import type { MulticaClient, MulticaIssue } from "./client.js";

/**
 * Multica issue ingest — the batch-fetch + classify + decided-store-filter
 * path this story ports from Claud-ometer's review-queue.ts
 * (getDelphiReviewQueue/readViaApi + the decided-store amnesia fix).
 *
 * Consus's decided-store equivalent is the existing `items.decided_at`
 * column (see docs/delphi-lineage-inventory.md's "Consus gap" note and
 * REQ-28's `/api/decisions` route, which already filters the same way) —
 * there is no separate JSON store to port, just the same filter rule
 * applied to ingested Multica issues.
 */

export function itemIdFor(multicaIssueId: string): string {
  return `multica:${multicaIssueId}`;
}

export interface IngestedMulticaItem {
  itemId: string;
  decisionType: DecisionType;
  triageBucket: TriageBucket;
}

/**
 * Upsert one Multica issue as an item and classify it. A re-ingested issue
 * (same id, seen again on a later batch fetch) updates title/status/labels
 * but never touches `decided_at` — once a human has decided an item, a
 * fresh Multica poll must not resurrect it into the active queue.
 */
export function ingestMulticaIssue(db: Database.Database, issue: MulticaIssue): IngestedMulticaItem {
  const itemId = itemIdFor(issue.id);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO items (id, type, title, status, source_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       source_ref = excluded.source_ref,
       updated_at = excluded.updated_at`,
  ).run(itemId, "multica_issue", issue.title, issue.status, issue.identifier, now, now);

  const { decisionType, triageBucket } = classifyItem(db, itemId);
  return { itemId, decisionType, triageBucket };
}

export interface IngestBatchResult {
  /** every issue ingested + classified this batch, regardless of decided state. */
  ingested: IngestedMulticaItem[];
  /** ingested items whose issue was already decided (decided_at set) — filtered out of the active queue. */
  filteredCount: number;
}

/** Ingest + classify a batch of Multica issues (bounded ~200 by listIssues), then
 *  filter out already-decided ones — the decided-store amnesia fix. */
export function ingestMulticaBatch(db: Database.Database, issues: MulticaIssue[]): IngestBatchResult {
  const ingested = issues.map((issue) => ingestMulticaIssue(db, issue));
  const decidedCount = countDecided(
    db,
    ingested.map((i) => i.itemId),
  );
  return { ingested, filteredCount: decidedCount };
}

function countDecided(db: Database.Database, itemIds: string[]): number {
  if (!itemIds.length) return 0;
  const placeholders = itemIds.map(() => "?").join(",");
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM items WHERE id IN (${placeholders}) AND decided_at IS NOT NULL`)
    .get(...itemIds) as { n: number };
  return row.n;
}

export interface ActiveMulticaQueueItem {
  itemId: string;
  title: string;
  status: string;
  decisionType: DecisionType | null;
  triageBucket: TriageBucket | null;
}

/** The active queue: ingested Multica issues that have NOT been decided yet
 *  (decided_at IS NULL) — mirrors REQ-28's `/api/decisions` default filter. */
export function listActiveMulticaQueue(db: Database.Database): ActiveMulticaQueueItem[] {
  const rows = db
    .prepare(
      `SELECT id, title, status, decision_type, triage_bucket
       FROM items
       WHERE id LIKE 'multica:%' AND decided_at IS NULL
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    status: string;
    decision_type: DecisionType | null;
    triage_bucket: TriageBucket | null;
  }>;

  return rows.map((row) => ({
    itemId: row.id,
    title: row.title,
    status: row.status,
    decisionType: row.decision_type,
    triageBucket: row.triage_bucket,
  }));
}

/** Fetch a batch from Multica (bounded, paginated — see HttpMulticaClient.listIssues)
 *  and ingest + classify every issue in one pass. Surfaces a fetch failure rather
 *  than silently ingesting nothing. */
export async function syncMulticaQueue(
  db: Database.Database,
  client: MulticaClient,
  opts?: { status?: string; limit?: number },
): Promise<{ ok: true; result: IngestBatchResult } | { ok: false; error: string }> {
  const listed = await client.listIssues(opts);
  if (!listed.ok) return { ok: false, error: listed.error };
  return { ok: true, result: ingestMulticaBatch(db, listed.issues) };
}
