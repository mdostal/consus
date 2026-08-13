import type Database from "better-sqlite3";
import { classifyItem, type DecisionType, type TriageBucket } from "../../decision-contract/classifier.js";
import type { MulticaClient, MulticaIssue } from "./client.js";

/**
 * Multica issue ingest — batch-fetch + upsert + classify. Ported from the
 * proven implementation on hive's consus@dev (PAN-7773/7776), adapted to
 * this build's decision-request/v1 contract-first classifier.
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
 * (same id, seen again on a later poll) updates title/status/source fields
 * but never touches `decided_at` — once a human has decided an item, a
 * fresh Multica poll must not resurrect it into the active queue.
 */
export function ingestMulticaIssue(db: Database.Database, issue: MulticaIssue): IngestedMulticaItem {
  const itemId = itemIdFor(issue.id);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO items (id, type, title, status, source_ref, source_body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       source_ref = excluded.source_ref,
       source_body = excluded.source_body,
       updated_at = excluded.updated_at`,
  ).run(itemId, "multica_issue", issue.title, issue.status, issue.identifier, issue.description, now, now);

  const { decisionType, triageBucket } = classifyItem(db, itemId);
  return { itemId, decisionType, triageBucket };
}

export interface IngestBatchResult {
  /** every issue ingested + classified this batch, regardless of decided state. */
  ingested: IngestedMulticaItem[];
  /** ingested items whose issue was already decided (decided_at set) — filtered out of the active queue. */
  filteredCount: number;
}

/** Ingest + classify a batch of Multica issues, then report how many were
 *  already decided — the decided-store amnesia-fix count. */
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

/** Fetch a batch from Multica and ingest + classify every issue in one pass.
 *  Surfaces a fetch failure rather than silently ingesting nothing, so a
 *  transient Multica outage never masks itself as "an empty queue." */
export async function syncMulticaQueue(
  db: Database.Database,
  client: MulticaClient,
  opts?: { status?: string; limit?: number; project?: string },
): Promise<{ ok: true; result: IngestBatchResult } | { ok: false; error: string }> {
  const listed = await client.listIssues(opts);
  if (!listed.ok) return { ok: false, error: listed.error };
  return { ok: true, result: ingestMulticaBatch(db, listed.issues) };
}
