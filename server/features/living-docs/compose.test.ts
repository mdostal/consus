import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { scanRepo } from "../../adapters/doc-scanner/index.js";
import { composeLivingDoc, composeEpicDocs } from "./compose.js";
import type { MulticaClient, MulticaIssue } from "../../adapters/multica/client.js";

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
});

describe("composeEpicDocs (Dual-source ingestion)", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-epic-repo-"));
    mkdirSync(join(repoDir, ".pHive", "epics", "epic-1", "docs"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "epics", "epic-1", "stories"), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns on-disk content merged with Multica metadata (Multica vs on-disk timestamps)", async () => {
    // 1. Setup on-disk newer
    writeFileSync(join(repoDir, ".pHive", "epics", "epic-1", "docs", "design-discussion.md"), "# Design Discussion\n\nLocal disk version.");
    writeFileSync(join(repoDir, ".pHive", "epics", "epic-1", "stories", "story-1.yaml"), "id: story-1\ntitle: 'Story 1 on disk'\nstatus: pending");

    const mockClient = {
      getIssue: vi.fn().mockResolvedValue({
        ok: true,
        issue: {
          id: "epic-1",
          title: "Epic 1",
          description: "Epic description from multica",
          status: "in_progress",
          labels: [],
          updatedAt: new Date(Date.now() - 100000).toISOString(),
          createdAt: new Date(Date.now() - 100000).toISOString(),
        }
      }),
      listIssues: vi.fn().mockResolvedValue({
        ok: true,
        issues: [
          {
            id: "story-1",
            title: "Story 1 Multica",
            status: "in_progress", // Multica is source of truth for state!
            parentIssueId: "epic-1",
            labels: [],
            updatedAt: new Date(Date.now() - 100000).toISOString(),
            createdAt: new Date(Date.now() - 100000).toISOString(),
          }
        ]
      }),
      listComments: vi.fn().mockResolvedValue({
        ok: true,
        comments: [
          {
            id: "c1",
            body: "# design-discussion\n\nMultica older version",
            updated_at: new Date(Date.now() - 100000).toISOString(),
          }
        ]
      })
    } as unknown as MulticaClient;

    const view = await composeEpicDocs(mockClient, "epic-1", repoDir);
    
    // docs merge
    expect(view.docs["design-discussion"]).toBeDefined();
    expect(view.docs["design-discussion"].content).toContain("Local disk version");
    expect(view.docs["design-discussion"].source).toBe("merged");

    // stories merge
    expect(view.stories).toHaveLength(1);
    expect(view.stories[0].title).toBe("Story 1 on disk"); // Disk is newer content
    expect(view.stories[0].status).toBe("in_progress"); // Multica is source of truth for state
    expect(view.stories[0].source).toBe("merged");
  });
});
