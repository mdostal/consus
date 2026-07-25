import type Database from "better-sqlite3";

/**
 * Idempotent base-schema migration. Safe to call on every server start —
 * every statement is CREATE TABLE IF NOT EXISTS, so re-running never errors
 * and never touches existing rows.
 */
export function runMigration(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      source_repo TEXT,
      source_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL REFERENCES items(id),
      actor TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_item_id ON audit_log(item_id);

    CREATE TABLE IF NOT EXISTS doc_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      epic TEXT,
      phase TEXT,
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      last_scanned_at TEXT NOT NULL,
      UNIQUE(repo, file_path)
    );
  `);
}
