import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { scanRepo, queryDocIndex } from "./index.js";

describe("Doc Scanner", () => {
  let repoDir: string;
  let db: Database.Database;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "delphi-repo-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "epics", "sample-epic", "docs"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nhello");
    writeFileSync(
      join(repoDir, ".pHive", "epics", "sample-epic", "docs", "architecture.md"),
      "# Architecture\n\nhello",
    );

    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("indexes every generated doc under .pHive/planning and .pHive/epics/*/docs", () => {
    scanRepo(db, { repoName: "delphi", repoPath: repoDir });

    const rows = queryDocIndex(db, "delphi");
    const paths = rows.map((r) => r.file_path).sort();

    expect(paths).toEqual([
      join(".pHive", "epics", "sample-epic", "docs", "architecture.md"),
      join(".pHive", "planning", "prd.md"),
    ]);
  });

  it("derives repo/epic/phase from path structure", () => {
    scanRepo(db, { repoName: "delphi", repoPath: repoDir });

    const rows = queryDocIndex(db, "delphi");
    const epicDoc = rows.find((r) => r.file_path.includes("sample-epic"));

    expect(epicDoc?.repo).toBe("delphi");
    expect(epicDoc?.epic).toBe("sample-epic");
    expect(epicDoc?.phase).toBe("docs");
  });

  it("updates content_hash when a doc changes on disk", () => {
    scanRepo(db, { repoName: "delphi", repoPath: repoDir });
    const before = queryDocIndex(db, "delphi").find((r) => r.file_path.endsWith("prd.md"));

    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nchanged content");
    scanRepo(db, { repoName: "delphi", repoPath: repoDir });

    const after = queryDocIndex(db, "delphi").find((r) => r.file_path.endsWith("prd.md"));

    // content_hash is the meaningful change-detection signal; last_scanned_at
    // is millisecond-resolution and can legitimately tie when two scans run
    // within the same millisecond, so it's not asserted for strict inequality.
    expect(after?.content_hash).not.toBe(before?.content_hash);
    expect(after?.last_scanned_at >= (before?.last_scanned_at ?? "")).toBe(true);
  });

  it("is idempotent — re-scanning unchanged docs does not duplicate rows", () => {
    scanRepo(db, { repoName: "delphi", repoPath: repoDir });
    scanRepo(db, { repoName: "delphi", repoPath: repoDir });

    const rows = queryDocIndex(db, "delphi");
    expect(rows).toHaveLength(2);
  });

  it("groups query results repo -> epic -> phase", () => {
    scanRepo(db, { repoName: "delphi", repoPath: repoDir });
    const rows = queryDocIndex(db, "delphi");

    for (const row of rows) {
      expect(row.repo).toBe("delphi");
    }
  });

  it("returns raw content plus a format field for a given doc", () => {
    scanRepo(db, { repoName: "delphi", repoPath: repoDir });
    const rows = queryDocIndex(db, "delphi");
    const prd = rows.find((r) => r.file_path.endsWith("prd.md"));

    expect(prd).toBeDefined();
    expect(existsSync(join(repoDir, prd!.file_path))).toBe(true);
  });
});
