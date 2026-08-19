import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerProjectRoutes } from "./projects.js";

/**
 * s2-branch-scoped-decisions: POST /api/projects/:project/ingest?ref=<branch>.
 * Reuses the temp-git-fixture pattern from git-ref.test.ts (s1's tests).
 */

function git(repoDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf-8" });
}

function decisionRequestBlock(title: string, optionsLabel: [string, string]): string {
  const payload = {
    version: "dostal:decision-request/v1",
    title,
    context: "context",
    options: [
      { id: "A", title: optionsLabel[0], tradeoffs: "tradeoff a" },
      { id: "B", title: optionsLabel[1], tradeoffs: "tradeoff b" },
    ],
    recommended: "A",
  };
  return ["# " + title, "", "```decision-request", JSON.stringify(payload), "```"].join("\n");
}

describe("POST /api/projects/:project/ingest?ref=<branch>", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-ref-ingest-"));
    git(repoDir, ["init", "-b", "main"]);
    git(repoDir, ["config", "user.email", "test@example.com"]);
    git(repoDir, ["config", "user.name", "Test"]);

    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(
      join(repoDir, ".pHive", "planning", "decision.md"),
      decisionRequestBlock("Pick a queue", ["SQS", "Redis streams"]),
    );
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "initial"]);

    git(repoDir, ["checkout", "-b", "feature/branch-doc"]);
    writeFileSync(
      join(repoDir, ".pHive", "planning", "branch-only-decision.md"),
      decisionRequestBlock("Enable branch flag", ["Yes", "No"]),
    );
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "branch-only decision"]);

    git(repoDir, ["checkout", "main"]);

    db = new Database(":memory:");
    runMigration(db);

    app = Fastify();
    registerProjectRoutes(app, { db, repos: { consus: repoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("AC2: a plain ingest (no ?ref=) creates a decision item with source_branch NULL, identical to pre-story behavior", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/consus/ingest" });
    expect(res.statusCode).toBe(200);

    const row = db
      .prepare("SELECT source_branch FROM items WHERE decision_payload IS NOT NULL")
      .get() as { source_branch: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row?.source_branch).toBeNull();
  });

  it("AC3: ?ref=<branch> creates a decision item with source_branch = '<branch>' for a doc that exists only on that branch", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/consus/ingest?ref=feature/branch-doc" });
    expect(res.statusCode).toBe(200);

    const row = db
      .prepare("SELECT id, title, source_branch FROM items WHERE title = ?")
      .get("Enable branch flag") as { id: string; title: string; source_branch: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row?.source_branch).toBe("feature/branch-doc");
  });

  it("AC3: a decision that also exists on main is not merged/duplicated into a conflicting item — main's item is untouched, the branch gets its own distinct item", async () => {
    // Scan main (working tree) first — decision.md exists there too.
    await app.inject({ method: "POST", url: "/api/projects/consus/ingest" });
    const mainItem = db
      .prepare("SELECT id, source_branch FROM items WHERE title = ? AND source_branch IS NULL")
      .get("Pick a queue") as { id: string; source_branch: string | null };
    expect(mainItem).toBeDefined();

    // Now scan the branch, which also carries decision.md (inherited from main).
    await app.inject({ method: "POST", url: "/api/projects/consus/ingest?ref=feature/branch-doc" });

    const rows = db.prepare("SELECT id, source_branch FROM items WHERE title = ?").all("Pick a queue") as Array<{
      id: string;
      source_branch: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source_branch).sort()).toEqual([null, "feature/branch-doc"].sort());

    // The main-scoped item's id is unchanged (not corrupted/overwritten).
    const mainItemAfter = db.prepare("SELECT id FROM items WHERE id = ?").get(mainItem.id);
    expect(mainItemAfter).toBeDefined();
  });

  it("scanning the same ref twice does not create duplicate items (idempotent, like the disk-based ingest)", async () => {
    await app.inject({ method: "POST", url: "/api/projects/consus/ingest?ref=feature/branch-doc" });
    await app.inject({ method: "POST", url: "/api/projects/consus/ingest?ref=feature/branch-doc" });

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM items WHERE source_branch = ?")
      .get("feature/branch-doc") as { n: number };
    // decision.md + branch-only-decision.md = 2 distinct branch-scoped items, not 4.
    expect(count.n).toBe(2);
  });

  it("AC6: an unresolvable ?ref= returns 400 (not 500) with a clear error, and writes no items and touches no doc_index rows", async () => {
    const beforeItems = db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number };
    const beforeDocIndex = db.prepare("SELECT COUNT(*) AS n FROM doc_index").get() as { n: number };

    const res = await app.inject({ method: "POST", url: "/api/projects/consus/ingest?ref=no-such-branch" });

    expect(res.statusCode).toBe(400);
    expect(typeof res.json().error).toBe("string");
    expect(res.json().error.length).toBeGreaterThan(0);

    const afterItems = db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number };
    const afterDocIndex = db.prepare("SELECT COUNT(*) AS n FROM doc_index").get() as { n: number };
    expect(afterItems.n).toBe(beforeItems.n);
    expect(afterDocIndex.n).toBe(beforeDocIndex.n);
  });

  it("classifies branch-scoped decision items (decision_type/triage_bucket populated), reusing classifyItem", async () => {
    await app.inject({ method: "POST", url: "/api/projects/consus/ingest?ref=feature/branch-doc" });

    const row = db
      .prepare("SELECT decision_type, triage_bucket FROM items WHERE title = ?")
      .get("Enable branch flag") as { decision_type: string | null; triage_bucket: string | null };

    expect(row.decision_type).not.toBeNull();
    expect(row.triage_bucket).not.toBeNull();
  });
});
