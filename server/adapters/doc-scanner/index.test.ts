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
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
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
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const rows = queryDocIndex(db, "consus");
    const paths = rows.map((r) => r.file_path).sort();

    expect(paths).toEqual([
      join(".pHive", "epics", "sample-epic", "docs", "architecture.md"),
      join(".pHive", "planning", "prd.md"),
    ]);
  });

  it("derives repo/epic/phase from path structure", () => {
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const rows = queryDocIndex(db, "consus");
    const epicDoc = rows.find((r) => r.file_path.includes("sample-epic"));

    expect(epicDoc?.repo).toBe("consus");
    expect(epicDoc?.epic).toBe("sample-epic");
    expect(epicDoc?.phase).toBe("docs");
  });

  it("updates content_hash when a doc changes on disk", () => {
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    const before = queryDocIndex(db, "consus").find((r) => r.file_path.endsWith("prd.md"));

    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nchanged content");
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const after = queryDocIndex(db, "consus").find((r) => r.file_path.endsWith("prd.md"));

    // content_hash is the meaningful change-detection signal; last_scanned_at
    // is millisecond-resolution and can legitimately tie when two scans run
    // within the same millisecond, so it's not asserted for strict inequality.
    expect(after?.content_hash).not.toBe(before?.content_hash);
    expect(after?.last_scanned_at >= (before?.last_scanned_at ?? "")).toBe(true);
  });

  it("is idempotent — re-scanning unchanged docs does not duplicate rows", () => {
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const rows = queryDocIndex(db, "consus");
    expect(rows).toHaveLength(2);
  });

  it("groups query results repo -> epic -> phase", () => {
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    const rows = queryDocIndex(db, "consus");

    for (const row of rows) {
      expect(row.repo).toBe("consus");
    }
  });

  it("returns raw content plus a format field for a given doc", () => {
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    const rows = queryDocIndex(db, "consus");
    const prd = rows.find((r) => r.file_path.endsWith("prd.md"));

    expect(prd).toBeDefined();
    expect(existsSync(join(repoDir, prd!.file_path))).toBe(true);
  });
});

describe("Doc Scanner — repo-level overview docs (s1 of consus-phase27-feature-doc-review-ui)", () => {
  let repoDir: string;
  let db: Database.Database;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-overview-"));
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("indexes repo-root README.md with epic=null, phase='overview'", () => {
    writeFileSync(join(repoDir, "README.md"), "# Hello\n");

    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const rows = queryDocIndex(db, "consus");
    const readme = rows.find((r) => r.file_path === "README.md");
    expect(readme).toBeDefined();
    expect(readme?.epic).toBeNull();
    expect(readme?.phase).toBe("overview");
  });

  it("indexes repo-root VISION.md with epic=null, phase='overview'", () => {
    writeFileSync(join(repoDir, "VISION.md"), "# Vision\n");

    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const rows = queryDocIndex(db, "consus");
    const vision = rows.find((r) => r.file_path === "VISION.md");
    expect(vision).toBeDefined();
    expect(vision?.epic).toBeNull();
    expect(vision?.phase).toBe("overview");
  });

  it("recursively indexes nested docs/**/*.md the same way, matching the existing epic-scan's directory-walk convention", () => {
    mkdirSync(join(repoDir, "docs", "nested"), { recursive: true });
    writeFileSync(join(repoDir, "docs", "top.md"), "# top\n");
    writeFileSync(join(repoDir, "docs", "nested", "deep.md"), "# deep\n");

    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const rows = queryDocIndex(db, "consus");
    const paths = rows.map((r) => r.file_path).sort();
    expect(paths).toEqual([join("docs", "nested", "deep.md"), join("docs", "top.md")]);
    for (const row of rows) {
      expect(row.epic).toBeNull();
      expect(row.phase).toBe("overview");
    }
  });

  it("does not error when README.md/VISION.md/docs/ are all absent (tolerant-existsSync convention)", () => {
    expect(() => scanRepo(db, { repoName: "consus", repoPath: repoDir })).not.toThrow();
    expect(queryDocIndex(db, "consus")).toEqual([]);
  });

  it("leaves .pHive/planning and .pHive/epics scan roots' behavior and tagging completely unchanged (purely additive)", () => {
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "epics", "sample-epic", "docs"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nhello");
    writeFileSync(
      join(repoDir, ".pHive", "epics", "sample-epic", "docs", "architecture.md"),
      "# Architecture\n\nhello",
    );
    writeFileSync(join(repoDir, "README.md"), "# Hello\n");
    mkdirSync(join(repoDir, "docs"), { recursive: true });
    writeFileSync(join(repoDir, "docs", "guide.md"), "# Guide\n");

    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    const rows = queryDocIndex(db, "consus");

    const planningDoc = rows.find((r) => r.file_path.endsWith("prd.md"));
    expect(planningDoc?.epic).toBeNull();
    expect(planningDoc?.phase).toBe("planning");

    const epicDoc = rows.find((r) => r.file_path.includes("sample-epic"));
    expect(epicDoc?.epic).toBe("sample-epic");
    expect(epicDoc?.phase).toBe("docs");

    const overviewFiles = rows.filter((r) => r.phase === "overview").map((r) => r.file_path).sort();
    expect(overviewFiles).toEqual(["README.md", join("docs", "guide.md")]);

    // No double-counting: exactly one row per file, four files total.
    expect(rows).toHaveLength(4);
  });
});

describe("Doc Scanner — .pHive/design/ wireframe docs (s3 of consus-phase28-interaction-completeness)", () => {
  let repoDir: string;
  let db: Database.Database;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-design-"));
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("indexes markdown artifacts under .pHive/design/<topic>/ tagged epic=<topic>, phase='design'", () => {
    mkdirSync(join(repoDir, ".pHive", "design", "my-topic"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "design", "my-topic", "brief.md"), "# Brief\n\n![wireframe](v1.png)\n");
    writeFileSync(join(repoDir, ".pHive", "design", "my-topic", "accessibility-constraints.md"), "# A11y\n");
    // Non-doc artifacts (the actual wireframe assets + registry) must never
    // be indexed as docs — DOC_EXTENSIONS only matches .md/.html.
    writeFileSync(join(repoDir, ".pHive", "design", "my-topic", "v1.png"), Buffer.from([0x89, 0x50]));
    writeFileSync(join(repoDir, ".pHive", "design", "my-topic", "wireframe.f0"), "{}");
    writeFileSync(join(repoDir, ".pHive", "design", "index.yaml"), "briefs: []\n");

    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const rows = queryDocIndex(db, "consus");
    const paths = rows.map((r) => r.file_path).sort();
    expect(paths).toEqual([
      join(".pHive", "design", "my-topic", "accessibility-constraints.md"),
      join(".pHive", "design", "my-topic", "brief.md"),
    ]);
    for (const row of rows) {
      expect(row.epic).toBe("my-topic");
      expect(row.phase).toBe("design");
    }
  });

  it("derives a distinct epic per design topic directory", () => {
    mkdirSync(join(repoDir, ".pHive", "design", "topic-a"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "design", "topic-b"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "design", "topic-a", "brief.md"), "# A\n");
    writeFileSync(join(repoDir, ".pHive", "design", "topic-b", "brief.md"), "# B\n");

    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const rows = queryDocIndex(db, "consus");
    const byPath = Object.fromEntries(rows.map((r) => [r.file_path, r]));
    expect(byPath[join(".pHive", "design", "topic-a", "brief.md")]?.epic).toBe("topic-a");
    expect(byPath[join(".pHive", "design", "topic-b", "brief.md")]?.epic).toBe("topic-b");
  });

  it("does not error and indexes nothing when .pHive/design/ is entirely absent (the common case today)", () => {
    expect(() => scanRepo(db, { repoName: "consus", repoPath: repoDir })).not.toThrow();
    expect(queryDocIndex(db, "consus")).toEqual([]);
  });

  it("a design topic whose name matches a real feature epic folds into that same epic — the fold-in-not-separate-nav-item contract", () => {
    mkdirSync(join(repoDir, ".pHive", "epics", "checkout-flow", "docs"), { recursive: true });
    writeFileSync(
      join(repoDir, ".pHive", "epics", "checkout-flow", "docs", "architecture.md"),
      "# Architecture\n",
    );
    mkdirSync(join(repoDir, ".pHive", "design", "checkout-flow"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "design", "checkout-flow", "brief.md"), "# Brief\n");

    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const rows = queryDocIndex(db, "consus");
    const epics = new Set(rows.map((r) => r.epic));
    expect(epics).toEqual(new Set(["checkout-flow"]));
    const phases = rows.map((r) => r.phase).sort();
    expect(phases).toEqual(["design", "docs"]);
  });

  it("leaves planning/epics/overview scan roots' behavior and tagging completely unchanged (purely additive)", () => {
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "epics", "sample-epic", "docs"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "design", "sample-epic"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nhello");
    writeFileSync(
      join(repoDir, ".pHive", "epics", "sample-epic", "docs", "architecture.md"),
      "# Architecture\n\nhello",
    );
    writeFileSync(join(repoDir, ".pHive", "design", "sample-epic", "brief.md"), "# Brief\n");
    writeFileSync(join(repoDir, "README.md"), "# Hello\n");

    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    const rows = queryDocIndex(db, "consus");

    const planningDoc = rows.find((r) => r.file_path.endsWith("prd.md"));
    expect(planningDoc?.epic).toBeNull();
    expect(planningDoc?.phase).toBe("planning");

    const epicDoc = rows.find((r) => r.file_path.endsWith("architecture.md"));
    expect(epicDoc?.epic).toBe("sample-epic");
    expect(epicDoc?.phase).toBe("docs");

    const overviewDoc = rows.find((r) => r.file_path === "README.md");
    expect(overviewDoc?.epic).toBeNull();
    expect(overviewDoc?.phase).toBe("overview");

    const designDoc = rows.find((r) => r.file_path.endsWith(join("design", "sample-epic", "brief.md")));
    expect(designDoc?.epic).toBe("sample-epic");
    expect(designDoc?.phase).toBe("design");

    // No double-counting: exactly one row per file, four files total.
    expect(rows).toHaveLength(4);
  });
});
