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
});
