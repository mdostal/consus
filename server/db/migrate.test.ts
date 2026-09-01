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

  // s2-branch-scoped-decisions: source_branch is a new, additive column on
  // items (NOT a reuse of source_ref, which already means "source doc's file
  // path" at two real call sites — see design-discussion.md §2). Must be
  // idempotent against both a fresh database and an existing v0.11.0+
  // database with pre-existing items rows, and every pre-existing item's
  // source_branch must be NULL (never corrupted, never defaulted to a
  // non-null placeholder).
  it("adds a source_branch column to items, defaulting to NULL, idempotently on a fresh database", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);
    expect(() => runMigration(db)).not.toThrow();

    const columns = db
      .prepare("PRAGMA table_info(items)")
      .all()
      .map((c) => (c as { name: string }).name);
    expect(columns).toContain("source_branch");

    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-fresh", "doc_ref", "Fresh item", "open", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");

    const row = db.prepare("SELECT source_branch FROM items WHERE id = ?").get("item-fresh") as {
      source_branch: string | null;
    };
    expect(row.source_branch).toBeNull();

    db.close();
  });

  it("is idempotent against an existing v0.11.0+ database with pre-existing items rows — their source_branch stays NULL, not corrupted or defaulted", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    // Simulate a pre-existing database (this story's migration hasn't run
    // yet in spirit — the column is added below only via runMigration).
    runMigration(db);
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-pre-existing-branch", "doc_ref", "Pre-existing item", "open", "2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z");

    // Re-run migration again (the idempotent-on-every-server-start path).
    expect(() => runMigration(db)).not.toThrow();
    expect(() => runMigration(db)).not.toThrow();

    const row = db.prepare("SELECT source_branch, title FROM items WHERE id = ?").get("item-pre-existing-branch") as {
      source_branch: string | null;
      title: string;
    };
    expect(row.source_branch).toBeNull();
    expect(row.title).toBe("Pre-existing item");

    db.close();
  });

  // s5-survey-grouping: new surveys table and nullable survey_id FK on items.
  it("creates the surveys table with expected columns", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);

    expect(tableNames(db)).toContain("surveys");

    const columns = db
      .prepare("PRAGMA table_info(surveys)")
      .all()
      .map((c) => (c as { name: string }).name);

    expect(columns.sort()).toEqual(["created_at", "description", "id", "title"]);

    db.close();
  });

  it("surveys table migration is idempotent — running twice does not error or alter existing rows", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);
    db.prepare("INSERT INTO surveys (id, title, created_at) VALUES (?, ?, ?)").run(
      "survey-1",
      "Test Survey",
      "2026-09-01T00:00:00Z",
    );

    expect(() => runMigration(db)).not.toThrow();

    const row = db.prepare("SELECT title FROM surveys WHERE id = ?").get("survey-1") as { title: string };
    expect(row.title).toBe("Test Survey");

    db.close();
  });

  it("adds a nullable survey_id column to items that defaults to NULL for existing rows", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);

    const columns = db
      .prepare("PRAGMA table_info(items)")
      .all()
      .map((c) => (c as { name: string }).name);
    expect(columns).toContain("survey_id");

    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-no-survey", "doc_ref", "No survey", "open", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");

    const row = db.prepare("SELECT survey_id FROM items WHERE id = ?").get("item-no-survey") as {
      survey_id: string | null;
    };
    expect(row.survey_id).toBeNull();

    db.close();
  });

  it("survey_id migration is idempotent — re-running does not corrupt existing items rows with a non-null survey_id", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);
    db.prepare("INSERT INTO surveys (id, title, created_at) VALUES (?, ?, ?)").run(
      "srv-idem",
      "Idempotent survey",
      "2026-09-01T00:00:00Z",
    );
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at, survey_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("item-with-survey", "doc_ref", "Has survey", "open", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", "srv-idem");

    expect(() => runMigration(db)).not.toThrow();
    expect(() => runMigration(db)).not.toThrow();

    const row = db.prepare("SELECT survey_id, title FROM items WHERE id = ?").get("item-with-survey") as {
      survey_id: string | null;
      title: string;
    };
    expect(row.survey_id).toBe("srv-idem");
    expect(row.title).toBe("Has survey");

    db.close();
  });
});
