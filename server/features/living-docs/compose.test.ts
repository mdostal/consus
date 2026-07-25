import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { scanRepo } from "../../adapters/doc-scanner/index.js";
import { composeLivingDoc } from "./compose.js";

describe("composeLivingDoc", () => {
  let repoDir: string;
  let db: Database.Database;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "architecture.md"), "# Architecture\n\nplan content");

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-1", "doc_ref", "Architecture note", "open", now, now);
    db.prepare(
      "INSERT INTO comments (item_id, author, body, created_at, multica_comment_id) VALUES (?, ?, ?, ?, ?)",
    ).run("item-1", "mathew", "let's revisit this", now, "mc-1");
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("composes references from Doc Scanner + local Multica-backed comments into one view", () => {
    const view = composeLivingDoc(db, { repoName: "consus", repoPath: repoDir, itemId: "item-1" });

    expect(view.docs).toHaveLength(1);
    expect(view.docs[0].file_path).toContain("architecture.md");
    expect(view.comments).toHaveLength(1);
    expect(view.comments[0].body).toBe("let's revisit this");
  });

  it("reflects current state on re-composition, not a one-time snapshot", () => {
    composeLivingDoc(db, { repoName: "consus", repoPath: repoDir, itemId: "item-1" });

    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nnew doc");
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const view = composeLivingDoc(db, { repoName: "consus", repoPath: repoDir, itemId: "item-1" });
    expect(view.docs).toHaveLength(2);
  });

  it("flags the idea board source as unavailable rather than silently omitting it", () => {
    const view = composeLivingDoc(db, { repoName: "consus", repoPath: repoDir, itemId: "item-1" });

    expect(view.ideaBoard).toEqual({ available: false, reason: "idea board integration point not yet specified" });
  });

  it("is confirmed distinct from Multica's board/task-state schema — an overlay, not a copy", () => {
    const view = composeLivingDoc(db, { repoName: "consus", repoPath: repoDir, itemId: "item-1" });

    // The overlay is a composed read-model; it carries no Multica board/task
    // fields (e.g. no `assignee`, `column`, `sprint`) — only references.
    expect(view).not.toHaveProperty("assignee");
    expect(view).not.toHaveProperty("column");
  });
});
