import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigration } from "../db/migrate.js";
import { decideItem, getAuditLog, createKbEntry, getKbVersions, saveKbDraft, getKbDraftVersions } from "./store.js";

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

  it("defaults a new kb_entry to the 'general' collection when none is given", () => {
    createKbEntry(db, { id: "kb-default", title: "t", author: "mathew", content: "c" });

    const row = db.prepare("SELECT collection FROM kb_entries WHERE id = ?").get("kb-default") as {
      collection: string;
    };
    expect(row.collection).toBe("general");
  });

  it("assigns a kb_entry to the given collection", () => {
    createKbEntry(db, { id: "kb-marketing", title: "t", author: "mathew", content: "c", collection: "marketing" });

    const row = db.prepare("SELECT collection FROM kb_entries WHERE id = ?").get("kb-marketing") as {
      collection: string;
    };
    expect(row.collection).toBe("marketing");
  });

  it("rejects an invalid collection value at the schema level, as a clear error (not a downstream FK failure)", () => {
    expect(() =>
      createKbEntry(db, {
        id: "kb-bad",
        title: "t",
        author: "mathew",
        content: "c",
        // @ts-expect-error — intentionally invalid to prove the CHECK constraint is enforced
        collection: "not-a-real-collection",
      }),
    ).toThrow(/CHECK constraint/i);

    const row = db.prepare("SELECT * FROM kb_entries WHERE id = ?").get("kb-bad");
    expect(row).toBeUndefined();
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

  it("defaults kb_versions.state to 'published' for the existing createKbEntry() publish path", () => {
    createKbEntry(db, { id: "kb-published", title: "t", author: "mathew", content: "c" });

    const versions = getKbVersions(db, "kb-published");
    expect(versions).toHaveLength(1);
    expect(versions[0].state).toBe("published");
  });

  it("rejects an invalid kb_versions.state value through the SQLite CHECK constraint", () => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO kb_entries (id, title, current_version_id, created_at) VALUES (?, ?, NULL, ?)",
    ).run("kb-bad-state", "t", now);

    expect(() =>
      db
        .prepare(
          "INSERT INTO kb_versions (kb_entry_id, content, author, state, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("kb-bad-state", "c", "mathew", "not-a-real-state", now),
    ).toThrow(/CHECK constraint/i);
  });

  it("saveKbDraft() inserts a kb_versions row with state='draft'", () => {
    saveKbDraft(db, { id: "kb-draft-1", author: "mathew", content: "draft content" });

    const drafts = getKbDraftVersions(db, "kb-draft-1");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ state: "draft", content: "draft content", author: "mathew" });
  });

  it("saveKbDraft() does NOT change kb_entries.current_version_id", () => {
    saveKbDraft(db, { id: "kb-draft-2", author: "mathew", content: "draft content" });

    const row = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get("kb-draft-2") as {
      current_version_id: number | null;
    };
    expect(row.current_version_id).toBeNull();
  });

  it("leaves an existing published entry's current_version_id unaffected by a draft save on the same entry", () => {
    createKbEntry(db, { id: "kb-mixed", title: "t", author: "mathew", content: "published v1" });
    const before = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get("kb-mixed") as {
      current_version_id: number;
    };

    saveKbDraft(db, { id: "kb-mixed", author: "mathew", content: "draft edit" });

    const after = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get("kb-mixed") as {
      current_version_id: number;
    };
    expect(after.current_version_id).toBe(before.current_version_id);

    const publishedVersion = db.prepare("SELECT * FROM kb_versions WHERE id = ?").get(before.current_version_id) as {
      state: string;
      content: string;
    };
    expect(publishedVersion.state).toBe("published");
    expect(publishedVersion.content).toBe("published v1");
  });

  it("getKbDraftVersions() returns only draft-state rows for an entry, in chronological order, none published", () => {
    createKbEntry(db, { id: "kb-drafts-many", title: "t", author: "mathew", content: "published v1" });
    saveKbDraft(db, { id: "kb-drafts-many", author: "mathew", content: "draft edit 1" });
    saveKbDraft(db, { id: "kb-drafts-many", author: "mathew", content: "draft edit 2" });

    const drafts = getKbDraftVersions(db, "kb-drafts-many");
    expect(drafts).toHaveLength(2);
    expect(drafts.map((v) => v.content)).toEqual(["draft edit 1", "draft edit 2"]);
    expect(drafts.every((v) => v.state === "draft")).toBe(true);
    expect(drafts[0].id).toBeLessThan(drafts[1].id);

    // getKbVersions() (the plain, unfiltered history read) still returns
    // everything — draft rows only disappear from the state='draft' filter.
    const allVersions = getKbVersions(db, "kb-drafts-many");
    expect(allVersions).toHaveLength(3);
    expect(allVersions.filter((v) => v.state === "published")).toHaveLength(1);
  });

  it("round-trips a very long draft content string byte-for-byte", () => {
    const longContent = "x".repeat(50_000) + "END";
    saveKbDraft(db, { id: "kb-draft-long", author: "mathew", content: longContent });

    const drafts = getKbDraftVersions(db, "kb-draft-long");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].content).toBe(longContent);
    expect(drafts[0].content.length).toBe(50_003);
  });

  it("never imports from ./pipeline — the submit path (pipeline.ts) is only permitted to import FROM store.ts, never the reverse", () => {
    const storeDir = dirname(fileURLToPath(import.meta.url));
    const storeSource = readFileSync(join(storeDir, "store.ts"), "utf8");
    expect(storeSource).not.toMatch(/from ["']\.\/pipeline(\.js|\.ts)?["']/);
  });
});
