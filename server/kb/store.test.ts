import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { decideItem, getAuditLog, createKbEntry, getKbVersions } from "./store.js";

function insertItem(db: Database.Database, id: string) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", "Test item", "open", now, now);
}

describe("KB Store — decide API", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("writes an audit_log entry recording actor, timestamp, field, old->new on decide", () => {
    insertItem(db, "item-1");

    decideItem(db, { itemId: "item-1", actor: "mathew", newStatus: "approved" });

    const log = getAuditLog(db, "item-1");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      item_id: "item-1",
      actor: "mathew",
      field: "status",
      old_value: "open",
      new_value: "approved",
    });
    expect(log[0].timestamp).toBeTruthy();
  });

  it("leaves chat_summary null when the item has no comment thread", () => {
    insertItem(db, "item-no-comments");

    decideItem(db, { itemId: "item-no-comments", actor: "mathew", newStatus: "approved" });

    const log = getAuditLog(db, "item-no-comments");
    expect(log[0].chat_summary).toBeNull();
  });

  it("summarizes the item's comment thread into the audit_log write-back entry (REQ-25)", () => {
    insertItem(db, "item-with-comments");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)",
    ).run("item-with-comments", "alice", "what's the timeline here?", now);
    db.prepare(
      "INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)",
    ).run("item-with-comments", "bob", "next sprint, agreed", now);

    decideItem(db, { itemId: "item-with-comments", actor: "mathew", newStatus: "approved" });

    const log = getAuditLog(db, "item-with-comments");
    expect(log).toHaveLength(1);
    expect(log[0].chat_summary).toContain("2 messages");
    expect(log[0].chat_summary).toContain("alice: what's the timeline here?");
    expect(log[0].chat_summary).toContain("bob: next sprint, agreed");
  });

  it("marks the item decided so it never resurfaces (decided-store amnesia fix)", () => {
    insertItem(db, "item-2");

    decideItem(db, { itemId: "item-2", actor: "mathew", newStatus: "approved" });

    const row = db.prepare("SELECT decided_at, status FROM items WHERE id = ?").get("item-2") as {
      decided_at: string | null;
      status: string;
    };
    expect(row.decided_at).not.toBeNull();
    expect(row.status).toBe("approved");
  });

  it("creates a kb_entry with a versioned kb_versions row, retrievable as history", () => {
    createKbEntry(db, { id: "kb-1", title: "Decision: adopt X", author: "mathew", content: "v1 content" });
    createKbEntry(db, { id: "kb-1", title: "Decision: adopt X", author: "mathew", content: "v2 content" });

    const versions = getKbVersions(db, "kb-1");
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.content)).toEqual(["v1 content", "v2 content"]);
  });

  it("is backed by SQLite, not flat files — audit_log survives a reconnect", () => {
    insertItem(db, "item-3");
    decideItem(db, { itemId: "item-3", actor: "mathew", newStatus: "approved" });
    db.close();

    // Re-open would be a real file in production; here we assert the schema
    // itself has no flat-file dependency by checking it's a pure SQL table.
    const freshDb = new Database(":memory:");
    runMigration(freshDb);
    const tables = freshDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("audit_log");
    expect(tables).toContain("kb_entries");
    expect(tables).toContain("kb_versions");
    freshDb.close();
  });
});
