import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";

/**
 * Generic importer for the delphi-audit.jsonl / delphi-knowledgebase.jsonl
 * archive shape (see .pHive/imports/multica-archive/README.md for
 * provenance). Parameterized by path — this run only imports this repo's
 * own preserved archive, but the importer itself is reusable for another
 * repo's archive later (each repo gets its own Consus install + store, per
 * s2-historical-backfill-importer's operator direction — no cross-repo
 * aggregation here).
 *
 * Idempotent: re-running against the same archive imports zero additional
 * rows. Items/kb_entries are upserted by a natural id derived from the
 * source; audit_log/kb_versions rows (which have no natural unique key in
 * the base schema) are deduped by an application-level existence check
 * rather than a new unique index, to keep the migration additive-only.
 */

interface AuditRow {
  ts: string;
  actor: string;
  itemId: string;
  identifier: string | null;
  action: string;
  statusFrom: string;
  statusTo: string;
  rationale: string;
  version: number;
}

interface KbRow {
  ts: string;
  kind: string;
  identifier: string | null;
  issueId: string;
  action: string;
  decision: unknown;
  rationale: string;
  document: unknown;
  items: unknown;
  status: string;
}

export interface ImportMulticaArchiveInput {
  auditPath: string;
  kbPath: string;
}

export interface ImportMulticaArchiveResult {
  auditRowsImported: number;
  kbRowsImported: number;
}

function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function itemIdFor(sourceItemId: string): string {
  return `delphi-archive:${sourceItemId}`;
}

function kbEntryIdFor(sourceIssueId: string): string {
  return `delphi-archive:${sourceIssueId}`;
}

/** Upsert one synthesized item per unique itemId, using the earliest ts as
 *  created_at and the latest entry's statusTo as the current status. */
function upsertSynthesizedItems(db: Database.Database, rows: AuditRow[]): void {
  const byItem = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const list = byItem.get(row.itemId) ?? [];
    list.push(row);
    byItem.set(row.itemId, list);
  }

  for (const [sourceItemId, entries] of byItem) {
    const sorted = [...entries].sort((a, b) => a.ts.localeCompare(b.ts));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    db.prepare(
      `INSERT INTO items (id, type, title, status, source_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`,
    ).run(
      itemIdFor(sourceItemId),
      "delphi_archive_item",
      first.identifier ?? sourceItemId,
      last.statusTo,
      first.identifier,
      first.ts,
      last.ts,
    );
  }
}

function auditRowExists(db: Database.Database, itemId: string, row: AuditRow): boolean {
  const existing = db
    .prepare(
      "SELECT 1 FROM audit_log WHERE item_id = ? AND actor = ? AND field = ? AND old_value = ? AND new_value = ? AND timestamp = ?",
    )
    .get(itemId, row.actor, "status", row.statusFrom, row.statusTo, row.ts);
  return Boolean(existing);
}

function importAuditRows(db: Database.Database, rows: AuditRow[]): number {
  upsertSynthesizedItems(db, rows);

  let imported = 0;
  for (const row of rows) {
    const itemId = itemIdFor(row.itemId);
    if (auditRowExists(db, itemId, row)) continue;

    db.prepare(
      "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(itemId, row.actor, "status", row.statusFrom, row.statusTo, row.ts);
    imported += 1;
  }
  return imported;
}

function kbVersionExists(db: Database.Database, kbEntryId: string, content: string): boolean {
  const existing = db
    .prepare("SELECT 1 FROM kb_versions WHERE kb_entry_id = ? AND content = ?")
    .get(kbEntryId, content);
  return Boolean(existing);
}

function importKbRows(db: Database.Database, rows: KbRow[]): number {
  let imported = 0;
  for (const row of rows) {
    const kbEntryId = kbEntryIdFor(row.issueId);
    const content = JSON.stringify({
      kind: row.kind,
      action: row.action,
      decision: row.decision,
      rationale: row.rationale,
      document: row.document,
      items: row.items,
      status: row.status,
    });

    if (kbVersionExists(db, kbEntryId, content)) continue;

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO kb_entries (id, title, created_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(kbEntryId, row.identifier ?? row.issueId, row.ts);

      const versionResult = db
        .prepare("INSERT INTO kb_versions (kb_entry_id, content, author, created_at) VALUES (?, ?, ?, ?)")
        .run(kbEntryId, content, "delphi-archive-import", row.ts);

      db.prepare("UPDATE kb_entries SET current_version_id = ? WHERE id = ?").run(
        versionResult.lastInsertRowid,
        kbEntryId,
      );
    });
    tx();
    imported += 1;
  }
  return imported;
}

export function importMulticaArchive(
  db: Database.Database,
  { auditPath, kbPath }: ImportMulticaArchiveInput,
): ImportMulticaArchiveResult {
  const auditRows = readJsonl<AuditRow>(auditPath);
  const kbRows = readJsonl<KbRow>(kbPath);

  const auditRowsImported = importAuditRows(db, auditRows);
  const kbRowsImported = importKbRows(db, kbRows);

  return { auditRowsImported, kbRowsImported };
}
