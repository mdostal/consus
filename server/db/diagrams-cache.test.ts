import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "./migrate.js";
import { getCachedDiagram, setCachedDiagram, invalidateDiagram } from "./diagrams-cache.js";

describe("diagrams cache", () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
    db = new Database(dbPath);
    runMigration(db);
  });

  afterEach(() => {
    db.close();
    if (dbPath && existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  it("diagrams table is created with correct columns", () => {
    const columns = db.prepare("PRAGMA table_info(diagrams)").all() as Array<{ name: string }>;
    const columnNames = columns.map(c => c.name);
    expect(columnNames).toContain("repo_id");
    expect(columnNames).toContain("diagram_type");
    expect(columnNames).toContain("mermaid_source");
    expect(columnNames).toContain("cached_at");
  });

  it("inserts and reads cached diagram", () => {
    const repoId = "test-repo";
    const type = "architecture";
    const source = "graph TD; A-->B;";
    
    setCachedDiagram(db, repoId, type, source);
    
    const cached = getCachedDiagram(db, repoId, type);
    expect(cached).toBeDefined();
    expect(cached?.mermaid_source).toBe(source);
    expect(cached?.cached_at).toBeDefined();
  });

  it("inserts and reads cascade diagram (null repo_id)", () => {
    const type = "cascade";
    const source = "graph TD; Cascade-->Tree;";
    
    setCachedDiagram(db, null, type, source);
    
    const cached = getCachedDiagram(db, null, type);
    expect(cached).toBeDefined();
    expect(cached?.mermaid_source).toBe(source);
  });

  it("invalidates diagram by timestamp (or deletes it)", () => {
    setCachedDiagram(db, "repo-1", "architecture", "graph TD; A-->B;");
    expect(getCachedDiagram(db, "repo-1", "architecture")).toBeDefined();
    
    invalidateDiagram(db, "repo-1", "architecture");
    
    expect(getCachedDiagram(db, "repo-1", "architecture")).toBeUndefined();
  });
});
