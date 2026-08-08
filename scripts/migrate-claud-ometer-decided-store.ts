#!/usr/bin/env node
import { readFileSync, renameSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import Database from "better-sqlite3";
import { openDb } from "../server/db/connection.js";
import { runMigration } from "../server/db/migrate.js";

/**
 * One-time backfill: Claud-ometer's `delphi-audit.jsonl` decided-store audit
 * trail -> Consus's `items` + `audit_log` tables, so already-decided items
 * (a) never resurface in GET /api/decisions, and (b) remain visible under
 * ?all=1 with their full decision history intact.
 *
 * Not a runtime sync — run this once, review the summary it prints, and (on
 * a real, non-dry-run pass) it archives the source file next to itself. The
 * source is never deleted.
 */

export const ITEM_ID_PREFIX = "claud-ometer-delphi:";
export const MIGRATED_FROM = "claud-ometer-delphi";
const DECISION_PAYLOAD_VERSION = "dostal:decision-request/v1";

export interface DelphiAuditEntry {
  ts: string;
  actor: string;
  itemId: string;
  identifier: string;
  action: string;
  statusFrom: string | null;
  statusTo: string | null;
  rationale: string | null;
  version: number;
}

export interface ParseResult {
  entries: DelphiAuditEntry[];
  malformedLines: Array<{ line: number; raw: string; error: string }>;
}

/**
 * Parses one JSON object per line. A malformed or structurally-incomplete
 * line is skipped (never throws) so one bad record can't sink the whole
 * migration — its line number and raw text are reported instead.
 */
export function parseAuditLog(jsonlContent: string): ParseResult {
  const entries: DelphiAuditEntry[] = [];
  const malformedLines: ParseResult["malformedLines"] = [];

  const lines = jsonlContent.split("\n");
  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    try {
      const candidate = JSON.parse(trimmed) as Partial<DelphiAuditEntry>;
      if (
        typeof candidate.itemId !== "string" ||
        typeof candidate.identifier !== "string" ||
        typeof candidate.action !== "string" ||
        typeof candidate.ts !== "string" ||
        typeof candidate.version !== "number"
      ) {
        throw new Error("missing required field (itemId, identifier, action, ts, version)");
      }
      entries.push({
        ts: candidate.ts,
        actor: candidate.actor ?? "unknown",
        itemId: candidate.itemId,
        identifier: candidate.identifier,
        action: candidate.action,
        statusFrom: candidate.statusFrom ?? null,
        statusTo: candidate.statusTo ?? null,
        rationale: candidate.rationale ?? null,
        version: candidate.version,
      });
    } catch (err) {
      malformedLines.push({
        line: index + 1,
        raw: trimmed,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { entries, malformedLines };
}

export interface DecidedItem {
  /** Namespaced Consus `items.id` — never the bare Multica UUID, so a migrated
   * row can never collide with a live-synced item. */
  id: string;
  identifier: string;
  history: DelphiAuditEntry[];
  final: DelphiAuditEntry;
}

/**
 * Groups audit entries by itemId and keeps the full version history per
 * item, sorted oldest-first. Duplicate lines (identical itemId + version)
 * collapse naturally — a Map keyed by itemId+version keeps only one. The
 * highest `version` entry is each item's authoritative decided state.
 */
export function groupDecidedItems(entries: DelphiAuditEntry[]): DecidedItem[] {
  const byItem = new Map<string, Map<number, DelphiAuditEntry>>();

  for (const entry of entries) {
    let versions = byItem.get(entry.itemId);
    if (!versions) {
      versions = new Map();
      byItem.set(entry.itemId, versions);
    }
    versions.set(entry.version, entry);
  }

  const items: DecidedItem[] = [];
  for (const [itemId, versions] of byItem) {
    const history = [...versions.values()].sort((a, b) => a.version - b.version);
    const final = history[history.length - 1];
    items.push({ id: `${ITEM_ID_PREFIX}${itemId}`, identifier: final.identifier, history, final });
  }

  return items;
}

function buildDecisionPayload(decision: DecidedItem): string {
  return JSON.stringify({
    version: DECISION_PAYLOAD_VERSION,
    title: decision.identifier,
    context: decision.final.rationale ?? "",
    options: [
      { id: "A", title: "Migrated verdict — see context", tradeoffs: "" },
      { id: "B", title: "N/A", tradeoffs: "" },
    ],
    recommended: "A",
    migratedFrom: MIGRATED_FROM,
    sourceAction: decision.final.action,
  });
}

export interface MigrationSummary {
  totalDecidedItems: number;
  inserted: number;
  alreadyPresent: number;
  malformedLines: ParseResult["malformedLines"];
}

/**
 * Inserts every not-yet-present decided item (and its full version history)
 * inside a single transaction — one bad row rolls back the whole run rather
 * than leaving a partial migration. Safe to re-run: an item already present
 * (by its namespaced id) is left untouched, so a second pass is a no-op.
 */
export function migrateDecidedItems(db: Database.Database, decisions: DecidedItem[]): MigrationSummary {
  const summary: MigrationSummary = {
    totalDecidedItems: decisions.length,
    inserted: 0,
    alreadyPresent: 0,
    malformedLines: [],
  };

  const insertItem = db.prepare(
    `INSERT INTO items (id, type, title, status, source_repo, source_ref, created_at, updated_at, decided_at, decision_payload)
     VALUES (@id, 'claud_ometer_decision', @title, @status, NULL, NULL, @createdAt, @updatedAt, @decidedAt, @decisionPayload)`,
  );
  const insertAuditLog = db.prepare(
    `INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp)
     VALUES (@itemId, @actor, 'status', @oldValue, @newValue, @timestamp)`,
  );
  const itemExists = db.prepare("SELECT 1 FROM items WHERE id = ?");

  const tx = db.transaction(() => {
    for (const decision of decisions) {
      if (itemExists.get(decision.id)) {
        summary.alreadyPresent++;
        continue;
      }

      insertItem.run({
        id: decision.id,
        title: decision.identifier,
        status: decision.final.statusTo ?? decision.final.action,
        createdAt: decision.history[0].ts,
        updatedAt: decision.final.ts,
        decidedAt: decision.final.ts,
        decisionPayload: buildDecisionPayload(decision),
      });

      for (const entry of decision.history) {
        insertAuditLog.run({
          itemId: decision.id,
          actor: entry.actor,
          oldValue: entry.statusFrom,
          newValue: entry.statusTo ?? entry.action,
          timestamp: entry.ts,
        });
      }

      summary.inserted++;
    }

    if (summary.inserted + summary.alreadyPresent !== decisions.length) {
      throw new Error("migration count mismatch — rolling back");
    }
  });
  tx();

  return summary;
}

export function defaultJsonlPath(): string {
  return `${homedir()}/.multica/delphi-audit.jsonl`;
}

export function defaultDbPath(): string {
  return process.env.CONSUS_DB_PATH ?? ".pHive/consus.sqlite";
}

function archivePath(jsonlPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${jsonlPath}.bak-migrated-${stamp}`;
}

export interface CliOptions {
  jsonlPath: string;
  dbPath: string;
  dryRun: boolean;
  archive: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    jsonlPath: defaultJsonlPath(),
    dbPath: defaultDbPath(),
    dryRun: false,
    archive: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--jsonl-path") options.jsonlPath = argv[++i];
    else if (arg === "--db-path") options.dbPath = argv[++i];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-archive") options.archive = false;
  }

  return options;
}

export interface CliRunResult {
  malformedLines: ParseResult["malformedLines"];
  summary: MigrationSummary | null;
  archivedTo: string | null;
  error?: string;
}

/**
 * The full non-CLI-parsing migration flow — parse, migrate, archive.
 * Exported separately from `main()` so tests can drive it with fixture
 * paths without touching process.argv or real files.
 */
export function runCli(options: CliOptions): CliRunResult {
  if (!existsSync(options.jsonlPath)) {
    return { malformedLines: [], summary: null, archivedTo: null, error: `No such file: ${options.jsonlPath}` };
  }

  const { entries, malformedLines } = parseAuditLog(readFileSync(options.jsonlPath, "utf-8"));
  const decisions = groupDecidedItems(entries);

  if (options.dryRun) {
    return { malformedLines, summary: null, archivedTo: null };
  }

  const db = openDb(options.dbPath);
  try {
    runMigration(db);
    const summary = migrateDecidedItems(db, decisions);

    let archivedTo: string | null = null;
    if (options.archive) {
      archivedTo = archivePath(options.jsonlPath);
      renameSync(options.jsonlPath, archivedTo);
    }

    return { malformedLines, summary, archivedTo };
  } finally {
    db.close();
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const result = runCli(options);

  if (result.error) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  console.log(`Parsed ${result.malformedLines.length} malformed line(s), skipped, from ${options.jsonlPath}`);
  for (const bad of result.malformedLines) {
    console.warn(`  line ${bad.line}: ${bad.error} — ${bad.raw.slice(0, 120)}`);
  }

  if (options.dryRun) {
    console.log(`Dry run — would target db at ${options.dbPath}, no changes made.`);
    return;
  }

  const { summary, archivedTo } = result;
  console.log(
    `Inserted ${summary!.inserted} decided item(s) into ${options.dbPath}; ${summary!.alreadyPresent} already present (skipped).`,
  );
  if (archivedTo) {
    console.log(`Archived source file to ${archivedTo} (original left in place, not deleted).`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
