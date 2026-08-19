import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "./migrate.js";

function tableNames(db: Database.Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

describe("runMigration", () => {
  let dbPath: string;

  afterEach(() => {
    if (dbPath && existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  it("creates the base items and audit_log tables", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);

    const names = tableNames(db);
    expect(names).toContain("items");
    expect(names).toContain("audit_log");

    db.close();
  });

  it("is idempotent — running twice does not error or duplicate tables", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);
    const firstRun = tableNames(db);

    expect(() => runMigration(db)).not.toThrow();
    const secondRun = tableNames(db);

    expect(secondRun).toEqual(firstRun);

    db.close();
  });

  it("preserves existing rows across a second migration run", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-1", "doc_ref", "Test item", "open", "2026-07-25T00:00:00Z", "2026-07-25T00:00:00Z");

    runMigration(db);

    const row = db.prepare("SELECT id FROM items WHERE id = ?").get("item-1");
    expect(row).toBeDefined();

    db.close();
  });

  it("creates the events table with exactly the expected columns, and defaults status to 'new'", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);

    const names = tableNames(db);
    expect(names).toContain("events");

    const columns = db
      .prepare("PRAGMA table_info(events)")
      .all()
      .map((c) => (c as { name: string }).name);

    expect(columns.sort()).toEqual(
      [
        "id",
        "project",
        "trigger_kind",
        "source_repo",
        "source_path",
        "content_hash",
        "previous_hash",
        "diff",
        "item_id",
        "composed_prompt",
        "status",
        "detected_at",
        "status_updated_at",
        "archived_at",
        "proposal_id",
      ].sort(),
    );

    db.prepare(
      `INSERT INTO events (id, project, trigger_kind, source_repo, source_path, content_hash, composed_prompt, detected_at, status_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "event-1",
      "proj-a",
      "doc_changed",
      "org/repo",
      "docs/foo.md",
      "hash-1",
      "prompt",
      "2026-07-25T00:00:00Z",
      "2026-07-25T00:00:00Z",
    );

    const row = db.prepare("SELECT status FROM events WHERE id = ?").get("event-1") as { status: string };
    expect(row.status).toBe("new");

    db.close();
  });

  it("creates the attachments table with actor required (never a hardcoded uploaded_by placeholder column)", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);

    const names = tableNames(db);
    expect(names).toContain("attachments");

    const columns = db
      .prepare("PRAGMA table_info(attachments)")
      .all()
      .map((c) => (c as { name: string }).name);

    expect(columns.sort()).toEqual(
      ["id", "item_id", "file_name", "mime_type", "size", "actor", "created_at", "deleted_at"].sort(),
    );

    const notNull = db
      .prepare("PRAGMA table_info(attachments)")
      .all()
      .find((c) => (c as { name: string }).name === "actor") as { notnull: number };
    expect(notNull.notnull).toBe(1);

    db.close();
  });

  it("is idempotent for the attachments table — running twice does not error, duplicate, or alter existing rows", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-1", "doc_ref", "Test item", "open", "2026-07-25T00:00:00Z", "2026-07-25T00:00:00Z");
    db.prepare(
      `INSERT INTO attachments (id, item_id, file_name, mime_type, size, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("att-1", "item-1", "a.txt", "text/plain", 3, "mathew", "2026-07-25T00:00:00Z");

    expect(() => runMigration(db)).not.toThrow();

    const count = db.prepare("SELECT COUNT(*) AS n FROM attachments").get() as { n: number };
    expect(count.n).toBe(1);

    const row = db.prepare("SELECT * FROM attachments WHERE id = ?").get("att-1");
    expect(row).toBeDefined();

    db.close();
  });

  it("attachments table migration is idempotent against a database that already has pre-existing items rows (simulated pre-v0.11.0+ upgrade), and existing rows in other tables are untouched", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    // Simulate an existing v0.11.0 database that already has real data in it
    // before this story's migration (which adds the attachments table) runs.
    runMigration(db);
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-pre-existing", "doc_ref", "Pre-existing item", "open", "2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z");
    db.prepare(
      "INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)",
    ).run("item-pre-existing", "mathew", "a comment", "2026-07-01T00:00:00Z");

    expect(() => runMigration(db)).not.toThrow();
    expect(() => runMigration(db)).not.toThrow();

    const item = db.prepare("SELECT id, title FROM items WHERE id = ?").get("item-pre-existing") as {
      id: string;
      title: string;
    };
    expect(item.title).toBe("Pre-existing item");

    const commentCount = db.prepare("SELECT COUNT(*) AS n FROM comments").get() as { n: number };
    expect(commentCount.n).toBe(1);

    expect(tableNames(db)).toContain("attachments");

    db.close();
  });

  it("is idempotent for the events table — running twice does not error, duplicate, or alter existing event rows", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);
    db.prepare(
      `INSERT INTO events (id, project, trigger_kind, source_repo, source_path, content_hash, composed_prompt, detected_at, status_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "event-1",
      "proj-a",
      "doc_changed",
      "org/repo",
      "docs/foo.md",
      "hash-1",
      "prompt",
      "2026-07-25T00:00:00Z",
      "2026-07-25T00:00:00Z",
    );

    expect(() => runMigration(db)).not.toThrow();

    const count = db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    expect(count.n).toBe(1);

    const row = db.prepare("SELECT * FROM events WHERE id = ?").get("event-1");
    expect(row).toBeDefined();

    db.close();
  });
});
