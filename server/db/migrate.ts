import type Database from "better-sqlite3";

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Idempotent base-schema migration. Safe to call on every server start —
 * every statement is CREATE TABLE IF NOT EXISTS (or a guarded ALTER TABLE),
 * so re-running never errors, never duplicates, and never touches existing
 * rows or data.
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
      source_body TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decided_at TEXT
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

    CREATE TABLE IF NOT EXISTS kb_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      current_version_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kb_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_entry_id TEXT NOT NULL REFERENCES kb_entries(id),
      content TEXT NOT NULL,
      author TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kb_versions_entry_id ON kb_versions(kb_entry_id);

    CREATE TABLE IF NOT EXISTS human_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL REFERENCES items(id),
      minerva_question_id TEXT NOT NULL UNIQUE,
      text TEXT NOT NULL,
      channel TEXT NOT NULL,
      reason TEXT,
      confidence REAL,
      suggested_channel TEXT,
      answer TEXT,
      status TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_human_requests_minerva_id ON human_requests(minerva_question_id);

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL REFERENCES items(id),
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      multica_comment_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_comments_item_id ON comments(item_id);

    CREATE TABLE IF NOT EXISTS triage_overrides (
      item_id TEXT PRIMARY KEY REFERENCES items(id),
      bucket TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL REFERENCES items(id),
      url TEXT NOT NULL,
      label TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_artifact_links_item_id ON artifact_links(item_id);

    CREATE TABLE IF NOT EXISTS surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      minerva_survey_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id),
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_by TEXT,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_item_id ON attachments(item_id);
  `);

  // Guarded ALTER TABLE for columns added after a table already existed on
  // some deployment — CREATE TABLE IF NOT EXISTS alone won't add these to a
  // pre-existing items table.
  addColumnIfMissing(db, "items", "decided_at", "TEXT");
  addColumnIfMissing(db, "items", "decision_payload", "TEXT");
  addColumnIfMissing(db, "items", "decision_type", "TEXT");
  addColumnIfMissing(db, "items", "triage_bucket", "TEXT");
  addColumnIfMissing(db, "items", "source_body", "TEXT");
  addColumnIfMissing(db, "human_requests", "answer", "TEXT");
  addColumnIfMissing(db, "human_requests", "survey_id", "INTEGER REFERENCES surveys(id)");
  addColumnIfMissing(db, "kb_entries", "source_repo", "TEXT");
  addColumnIfMissing(db, "kb_versions", "state", "TEXT NOT NULL DEFAULT 'published'");
  addColumnIfMissing(db, "attachments", "deleted_at", "TEXT");
}
