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
      null,
      "parked",
      "2026-08-10T00:00:00Z"
    );

    const row = db.prepare("SELECT * FROM parked_workflows WHERE id = ?").get("pw-1") as any;
    expect(row.agent_name).toBe("researcher");
    expect(JSON.parse(row.parked_state)).toEqual({ some_key: "some_value" });

    db.close();
  });
});
