import type Database from "better-sqlite3";

export interface AuditLogRow {
  id: number;
  item_id: string;
  actor: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
}

export interface KbVersionRow {
  id: number;
  kb_entry_id: string;
  content: string;
  author: string;
  state: "published" | "draft";
  created_at: string;
}

export const KB_COLLECTIONS = ["marketing", "boundary-decisions", "plans", "artifacts", "general"] as const;
export type KbCollection = (typeof KB_COLLECTIONS)[number];

export interface KbEntryRow {
  id: string;
  title: string;
  current_version_id: number | null;
  created_at: string;
  source_repo: string | null;
  collection: KbCollection;
}

export interface DecideItemInput {
  itemId: string;
  actor: string;
  newStatus: string;
}

/**
 * Approve/decide an item: writes an append-only audit_log entry (actor,
 * timestamp, field, old->new) and marks the item decided so it never
 * resurfaces in the open queue (the "decided-store amnesia fix").
 */
export function decideItem(db: Database.Database, { itemId, actor, newStatus }: DecideItemInput): void {
  const item = db.prepare("SELECT status FROM items WHERE id = ?").get(itemId) as
    | { status: string }
    | undefined;
  if (!item) {
    throw new Error(`item not found: ${itemId}`);
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(itemId, actor, "status", item.status, newStatus, now);

    db.prepare("UPDATE items SET status = ?, updated_at = ?, decided_at = ? WHERE id = ?").run(
      newStatus,
      now,
      now,
      itemId,
    );
  });
  tx();
}

export function getAuditLog(db: Database.Database, itemId: string): AuditLogRow[] {
  return db
    .prepare("SELECT * FROM audit_log WHERE item_id = ? ORDER BY timestamp ASC")
    .all(itemId) as AuditLogRow[];
}

export interface CreateKbEntryInput {
  id: string;
  title: string;
  author: string;
  content: string;
  /** Project/repo this entry belongs to (REQ-27) — nullable for backward compatibility. */
  sourceRepo?: string | null;
  /** Collection bucket for KB grouping; defaults to general for backward compatibility. */
  collection?: KbCollection;
}

export interface SaveKbDraftInput {
  id: string;
  title?: string;
  author: string;
  content: string;
  /** Project/repo this entry belongs to (REQ-27) — nullable for backward compatibility. */
  sourceRepo?: string | null;
}

/**
 * Create (or add a new version to) a kb_entry. Every call appends a new
 * kb_versions row and repoints current_version_id — history is never lost.
 */
export function createKbEntry(
  db: Database.Database,
  { id, title, author, content, sourceRepo, collection = "general" }: CreateKbEntryInput,
): void {
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO kb_entries (id, title, current_version_id, created_at, source_repo, collection) VALUES (?, ?, NULL, ?, ?, ?)",
    ).run(id, title, now, sourceRepo ?? null, collection);

    const result = db
      .prepare("INSERT INTO kb_versions (kb_entry_id, content, author, state, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, content, author, "published", now);

    db.prepare("UPDATE kb_entries SET current_version_id = ? WHERE id = ?").run(result.lastInsertRowid, id);
  });
  tx();
}

/**
 * Persist a human draft as an append-only kb_versions row without changing
 * current_version_id. Published/agent versions remain the visible KB state.
 */
export function saveKbDraft(
  db: Database.Database,
  { id, title, author, content, sourceRepo }: SaveKbDraftInput,
): KbVersionRow {
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO kb_entries (id, title, current_version_id, created_at, source_repo) VALUES (?, ?, NULL, ?, ?)",
    ).run(id, title ?? id, now, sourceRepo ?? null);

    const result = db
      .prepare("INSERT INTO kb_versions (kb_entry_id, content, author, state, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, content, author, "draft", now);

    return db.prepare("SELECT * FROM kb_versions WHERE id = ?").get(result.lastInsertRowid) as KbVersionRow;
  });
  return tx();
}

export interface GetKbEntriesFilters {
  project?: string;
  q?: string;
  collection?: KbCollection;
}

export function getKbEntries(
  db: Database.Database,
  { project, q, collection }: GetKbEntriesFilters = {},
): KbEntryRow[] {
  const params: string[] = [];
  const where: string[] = [];
  const joins = q ? "JOIN kb_versions v ON v.kb_entry_id = e.id" : "";

  if (q) {
    where.push("v.state = 'published'");
    where.push("(e.title LIKE ? OR v.content LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }

  if (project) {
    where.push("e.source_repo = ?");
    params.push(project);
  }

  if (collection) {
    where.push("e.collection = ?");
    params.push(collection);
  }

  const sql = [
    `SELECT DISTINCT e.* FROM kb_entries e ${joins}`,
    where.length ? `WHERE ${where.join(" AND ")}` : "",
    "ORDER BY e.created_at DESC",
  ]
    .filter(Boolean)
    .join(" ");

  return db.prepare(sql).all(...params) as KbEntryRow[];
}

export function getKbVersions(db: Database.Database, kbEntryId: string): KbVersionRow[] {
  return db
    .prepare("SELECT * FROM kb_versions WHERE kb_entry_id = ? ORDER BY id ASC")
    .all(kbEntryId) as KbVersionRow[];
}

export function getKbDraftVersions(db: Database.Database, kbEntryId: string): KbVersionRow[] {
  return db
    .prepare("SELECT * FROM kb_versions WHERE kb_entry_id = ? AND state = 'draft' ORDER BY id ASC")
    .all(kbEntryId) as KbVersionRow[];
}
