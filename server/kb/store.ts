import type Database from "better-sqlite3";
import { summarizeChat } from "./chat-summary.js";

export interface AuditLogRow {
  id: number;
  item_id: string;
  actor: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
  chat_summary: string | null;
}

export interface KbVersionRow {
  id: number;
  kb_entry_id: string;
  content: string;
  author: string;
  /** p11-01: 'published' rows are visible KB content; 'draft' rows are not. */
  state: "published" | "draft";
  created_at: string;
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
 *
 * REQ-25: the item's comment thread is summarized (summarizeChat, ported
 * from Claud-ometer's chat-store.ts) into the same audit_log write-back
 * entry, so the decision record carries its discussion context, not just
 * the verdict.
 */
export function decideItem(db: Database.Database, { itemId, actor, newStatus }: DecideItemInput): void {
  const item = db.prepare("SELECT status FROM items WHERE id = ?").get(itemId) as
    | { status: string }
    | undefined;
  if (!item) {
    throw new Error(`item not found: ${itemId}`);
  }

  const now = new Date().toISOString();
  const comments = db
    .prepare("SELECT author, body FROM comments WHERE item_id = ? ORDER BY created_at ASC")
    .all(itemId) as Array<{ author: string; body: string }>;
  const chatSummary = summarizeChat(comments);

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp, chat_summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(itemId, actor, "status", item.status, newStatus, now, chatSummary);

    db.prepare("UPDATE items SET status = ?, updated_at = ?, decided_at = ? WHERE id = ?").run(
      newStatus,
      now,
      now,
      itemId,
    );
  });
  tx();
}

/**
 * Close a set of items without deleting anything: each one still open
 * (undecided, not already closed) gets status 'closed', an audit_log row and a
 * comment carrying `comment`. Decided or already-closed items are skipped, so
 * a repeat call is a no-op. Returns the ids actually closed, in input order.
 * Shared by POST /api/questions/:ticket/close and POST /api/items/:id/close.
 */
export function closeOpenItems(db: Database.Database, itemIds: string[], actor: string, comment: string): string[] {
  const now = new Date().toISOString();
  const closed: string[] = [];
  const tx = db.transaction(() => {
    for (const id of itemIds) {
      const item = db
        .prepare("SELECT status FROM items WHERE id = ? AND decided_at IS NULL AND status != 'closed'")
        .get(id) as { status: string } | undefined;
      if (!item) continue;
      db.prepare("UPDATE items SET status = 'closed', updated_at = ? WHERE id = ?").run(now, id);
      db.prepare(
        "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, actor, "status", item.status, "closed", now);
      db.prepare("INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)").run(
        id,
        actor,
        comment,
        now,
      );
      closed.push(id);
    }
  });
  tx();
  return closed;
}

export function getAuditLog(db: Database.Database, itemId: string): AuditLogRow[] {
  return db
    .prepare("SELECT * FROM audit_log WHERE item_id = ? ORDER BY timestamp ASC")
    .all(itemId) as AuditLogRow[];
}

export type KbCollection = "marketing" | "boundary-decisions" | "plans" | "artifacts" | "general";

export interface CreateKbEntryInput {
  id: string;
  title: string;
  author: string;
  content: string;
  /** Project/repo this entry belongs to (REQ-27) — nullable for backward compatibility. */
  sourceRepo?: string | null;
  /** Collection bucket for KB grouping (kb-01); defaults to 'general'. */
  collection?: KbCollection;
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
    // ON CONFLICT DO NOTHING (not "INSERT OR IGNORE") — IGNORE would also
    // silently swallow a CHECK constraint violation on `collection`
    // (confirmed: it does, per SQLite's ON CONFLICT-clause semantics for
    // the legacy OR IGNORE form), turning a bad value into a confusing
    // downstream FK error on the kb_versions insert below instead of a
    // clear failure here. DO NOTHING only suppresses the id conflict.
    db.prepare(
      `INSERT INTO kb_entries (id, title, current_version_id, created_at, source_repo, collection)
       VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(id, title, now, sourceRepo ?? null, collection);

    const result = db
      .prepare("INSERT INTO kb_versions (kb_entry_id, content, author, state, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, content, author, "published", now);

    db.prepare("UPDATE kb_entries SET current_version_id = ? WHERE id = ?").run(result.lastInsertRowid, id);
  });
  tx();
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
 * Persist an in-progress edit as a kb_versions row with state='draft'
 * WITHOUT repointing kb_entries.current_version_id — the structural
 * mechanism that keeps a draft from instantly becoming published content
 * (REQ-17, "Save != Submit").
 */
export function saveKbDraft(
  db: Database.Database,
  { id, title, author, content, sourceRepo }: SaveKbDraftInput,
): void {
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // ON CONFLICT DO NOTHING — see createKbEntry() above for why this form
    // is used instead of INSERT OR IGNORE (which would also silently
    // swallow a CHECK constraint violation on `collection`).
    db.prepare(
      `INSERT INTO kb_entries (id, title, current_version_id, created_at, source_repo)
       VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(id, title ?? id, now, sourceRepo ?? null);

    db.prepare(
      "INSERT INTO kb_versions (kb_entry_id, content, author, state, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, content, author, "draft", now);
  });
  tx();
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
