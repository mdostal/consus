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

function tableColumns(db: Database.Database, tableName: string) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => row as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number });
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

  it("creates the v1 core schema tables with expected columns", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);

    expect(tableColumns(db, "parked_questions")).toEqual([
      expect.objectContaining({ name: "id", type: "TEXT", pk: 1 }),
      expect.objectContaining({ name: "agent_id", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "agent_name", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "context", type: "TEXT" }),
      expect.objectContaining({ name: "question", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "parked_workflow_id", type: "TEXT" }),
      expect.objectContaining({ name: "callback_url", type: "TEXT" }),
      expect.objectContaining({ name: "multica_issue_id", type: "TEXT" }),
      expect.objectContaining({ name: "resolved", type: "INTEGER", dflt_value: "0" }),
      expect.objectContaining({ name: "answer", type: "TEXT" }),
      expect.objectContaining({ name: "answered_by", type: "TEXT" }),
      expect.objectContaining({ name: "answered_at", type: "TEXT" }),
      expect.objectContaining({ name: "created_at", type: "TEXT", dflt_value: "CURRENT_TIMESTAMP" }),
    ]);
    expect(tableColumns(db, "doc_edits")).toEqual([
      expect.objectContaining({ name: "id", type: "TEXT", pk: 1 }),
      expect.objectContaining({ name: "repo", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "file_path", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "content", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "edited_by", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "committed_to_disk", type: "INTEGER", dflt_value: "0" }),
      expect.objectContaining({ name: "created_at", type: "TEXT", dflt_value: "CURRENT_TIMESTAMP" }),
    ]);
    expect(tableColumns(db, "fired_tickets")).toEqual([
      expect.objectContaining({ name: "id", type: "TEXT", pk: 1 }),
      expect.objectContaining({ name: "edit_id", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "multica_issue_id", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "target_repo", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "fired_by", type: "TEXT", notnull: 1 }),
      expect.objectContaining({ name: "fired_at", type: "TEXT", dflt_value: "CURRENT_TIMESTAMP" }),
    ]);

    db.close();
  });

  it("can insert and query v1 core schema rows", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);
    db.prepare(
      "INSERT INTO parked_questions (id, agent_id, agent_name, context, question) VALUES (?, ?, ?, ?, ?)",
    ).run("question-1", "agent-1", "Auriga", "while editing docs", "What repo should receive this?");
    db.prepare(
      "INSERT INTO doc_edits (id, repo, file_path, content, edited_by) VALUES (?, ?, ?, ?, ?)",
    ).run("edit-1", "mdostal/consus", "docs/example.md", "# Draft", "auriga");
    db.prepare(
      "INSERT INTO fired_tickets (id, edit_id, multica_issue_id, target_repo, fired_by) VALUES (?, ?, ?, ?, ?)",
    ).run("ticket-1", "edit-1", "PAN-9000", "mdostal/consus", "auriga");

    expect(db.prepare("SELECT resolved FROM parked_questions WHERE id = ?").get("question-1")).toEqual({
      resolved: 0,
    });
    expect(db.prepare("SELECT committed_to_disk FROM doc_edits WHERE id = ?").get("edit-1")).toEqual({
      committed_to_disk: 0,
    });
    expect(db.prepare("SELECT edit_id FROM fired_tickets WHERE id = ?").get("ticket-1")).toEqual({
      edit_id: "edit-1",
    });

    db.close();
  });

  it("enforces fired_tickets edit_id references", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);

    expect(() =>
      db
        .prepare(
          "INSERT INTO fired_tickets (id, edit_id, multica_issue_id, target_repo, fired_by) VALUES (?, ?, ?, ?, ?)",
        )
        .run("ticket-1", "missing-edit", "PAN-9000", "mdostal/consus", "auriga"),
    ).toThrow(/FOREIGN KEY constraint failed/);

    db.close();
  });

  it("adds draft state to existing kb_versions rows without rewriting content", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE kb_entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        current_version_id INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE kb_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kb_entry_id TEXT NOT NULL REFERENCES kb_entries(id),
        content TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO kb_entries (id, title, current_version_id, created_at) VALUES (?, ?, NULL, ?)").run(
      "kb-1",
      "Existing",
      "2026-08-09T00:00:00Z",
    );
    db.prepare("INSERT INTO kb_versions (kb_entry_id, content, author, created_at) VALUES (?, ?, ?, ?)").run(
      "kb-1",
      "existing content",
      "agent",
      "2026-08-09T00:00:00Z",
    );

    runMigration(db);

    const row = db.prepare("SELECT content, state FROM kb_versions WHERE kb_entry_id = ?").get("kb-1") as {
      content: string;
      state: string;
    };
    expect(row).toEqual({ content: "existing content", state: "published" });

    db.close();
  });

  it("creates the parked_workflows table and allows inserting a record", () => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    const db = new Database(dbPath);

    runMigration(db);

    const names = tableNames(db);
    expect(names).toContain("parked_workflows");

    db.prepare(
      "INSERT INTO parked_workflows (id, agent_name, workflow_type, parked_state, question_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "pw-1",
      "researcher",
      "research",
      JSON.stringify({ some_key: "some_value" }),
      "question-1",
      "parked",
      "2026-08-10T00:00:00Z"
    );

    const row = db.prepare("SELECT * FROM parked_workflows WHERE id = ?").get("pw-1") as any;
    expect(row.agent_name).toBe("researcher");
    expect(JSON.parse(row.parked_state)).toEqual({ some_key: "some_value" });

    db.close();
  });
});
