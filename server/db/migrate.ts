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
      created_at TEXT NOT NULL,
      collection TEXT NOT NULL DEFAULT 'general' CHECK(collection IN ('marketing', 'boundary-decisions', 'plans', 'artifacts', 'general'))
    );

    CREATE TABLE IF NOT EXISTS kb_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_entry_id TEXT NOT NULL REFERENCES kb_entries(id),
      content TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kb_versions_entry_id ON kb_versions(kb_entry_id);

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL REFERENCES items(id),
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      external_ref TEXT
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

    -- s3-propose-dispatch-mechanism: a change proposal (diff + description)
    -- fired to a generic harness (server/harness/transport.ts). Consus never
    -- writes the underlying content directly — the harness applies it and
    -- reports back via POST /api/proposals/:id/result, which is what
    -- transitions status out of 'pending' and (on 'applied') writes an
    -- audit_log entry.
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id),
      target_type TEXT NOT NULL,
      diff TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'failed')),
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      applied_diff TEXT,
      failure_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_proposals_item_id ON proposals(item_id);

    -- p14-1: a pre-decision review-queue item, deliberately separate from
    -- proposals — an event may never become a proposal at all. Detected by
    -- the (not-yet-built) multi-repo scan/detection step and surfaced to an
    -- operator for triage; updateEventStatus (server/events/store.ts) is
    -- what drives archived_at as status moves in/out of the terminal
    -- done/dismissed states.
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('doc_changed', 'decision_needed')),
      source_repo TEXT NOT NULL,
      source_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      previous_hash TEXT,
      diff TEXT,
      item_id TEXT REFERENCES items(id),
      composed_prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','done','dismissed')),
      detected_at TEXT NOT NULL,
      status_updated_at TEXT NOT NULL,
      archived_at TEXT,
      proposal_id TEXT REFERENCES proposals(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_events_archived_at ON events(archived_at);

    -- s1-attachment-storage-and-api: files (screenshots, PDFs, exported
    -- docs) attached to a decision item, stored on local disk via
    -- FilesystemStorage (server/storage/) under CONSUS_ATTACHMENTS_DIR /
    -- .pHive/attachments -- never S3 (standalone/local-first, no current
    -- cloud-deploy need). Ported from origin/feat/PAN-7819's
    -- server/db/migrate.ts (attachments table), re-derived against this
    -- build's current schema/house-style rather than cherry-picked:
    -- uploaded_by (a hardcoded "authenticated_user" placeholder on the old
    -- branch) is actor here and NOT NULL, matching the audit_log.actor /
    -- decideItem convention every other Consus write path already uses for
    -- "who did this" in a no-auth-layer, standalone tool. Soft-delete only
    -- (deleted_at) -- no cleanup job removes the underlying file, matching
    -- the old branch's own documented scope.
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id),
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_item_id ON attachments(item_id);
  `);

  // Guarded ALTER TABLE for columns added after a table already existed on
  // some deployment — CREATE TABLE IF NOT EXISTS alone won't add these to a
  // pre-existing items table.
  addColumnIfMissing(db, "items", "source_body", "TEXT");
  addColumnIfMissing(db, "items", "decided_at", "TEXT");
  addColumnIfMissing(db, "items", "decision_payload", "TEXT");
  addColumnIfMissing(db, "items", "decision_type", "TEXT");
  addColumnIfMissing(db, "items", "triage_bucket", "TEXT");
  addColumnIfMissing(db, "kb_entries", "source_repo", "TEXT");
  addColumnIfMissing(db, "audit_log", "chat_summary", "TEXT");
  // REQ (kb-01): collection grouping for KB entries. Ported from
  // hive:~/.review-bootstrap/consus-kb01 (feat/PAN-6478), re-derived
  // against this build's current schema rather than cherry-picked.
  addColumnIfMissing(
    db,
    "kb_entries",
    "collection",
    "TEXT NOT NULL DEFAULT 'general' CHECK(collection IN ('marketing', 'boundary-decisions', 'plans', 'artifacts', 'general'))",
  );
  // p11-01: draft/published storage split (REQ-17, "Save != Submit").
  // Defaults to 'published' so every existing row and every existing
  // createKbEntry() call remains valid published content with zero backfill.
  addColumnIfMissing(
    db,
    "kb_versions",
    "state",
    "TEXT NOT NULL DEFAULT 'published' CHECK(state IN ('published', 'draft'))",
  );

  db.exec("CREATE INDEX IF NOT EXISTS idx_kb_entries_collection ON kb_entries(collection)");
}
