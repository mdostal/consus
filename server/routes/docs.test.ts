import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { registerDocRoutes } from "./docs.js";

describe("GET /api/docs", () => {
  let repoDir: string;
  let otherRepoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nhello world");

    otherRepoDir = mkdtempSync(join(tmpdir(), "consus-other-repo-"));
    mkdirSync(join(otherRepoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(otherRepoDir, ".pHive", "planning", "architecture.md"), "# Architecture\n\nother project doc");

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    scanRepo(db, { repoName: "other-project", repoPath: otherRepoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(otherRepoDir, { recursive: true, force: true });
  });

  it("lists docs grouped by repo/epic/phase across every configured project by default", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.consus).toBeDefined();
    expect(body.consus.planning).toBeDefined();
    expect(body["other-project"]).toBeDefined();
  });

  it("scopes to a single project via ?project=, excluding every other project (REQ-27)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs?project=consus" });
    const body = res.json();

    expect(body.consus).toBeDefined();
    expect(body["other-project"]).toBeUndefined();
  });

  it("returns formatted content for a specific doc", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(join(".pHive", "planning", "prd.md"))}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.format).toBe("md");
    expect(body.content).toContain("hello world");
  });

  it("upserts a target item for the doc so a propose-a-change action always has something to target (s5)", async () => {
    const path = join(".pHive", "planning", "prd.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}`,
    });
    const body = res.json();

    expect(body.itemId).toBeTruthy();
    const row = db.prepare("SELECT type, source_repo FROM items WHERE id = ?").get(body.itemId) as {
      type: string;
      source_repo: string;
    };
    expect(row.type).toBe("doc");
    expect(row.source_repo).toBe("consus");

    // idempotent — reopening doesn't duplicate the item
    await app.inject({ method: "GET", url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}` });
    const count = db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = ?").get(body.itemId) as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("GET /api/docs/content?ref=", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;
  let firstCommitSha: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-gitrepo-"));
    execFileSync("git", ["init"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD v1\n\noriginal content");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "v1"], { cwd: repoDir });
    firstCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();

    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD v2\n\nupdated content");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "v2"], { cwd: repoDir });

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns the ref's historical content and echoes ref back, when a valid ref is given", async () => {
    const path = join(".pHive", "planning", "prd.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}&ref=${firstCommitSha}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain("original content");
    expect(body.content).not.toContain("updated content");
    expect(body.ref).toBe(firstCommitSha);
  });

  it("returns current working-tree content, not the ref field, when ref is omitted", async () => {
    const path = join(".pHive", "planning", "prd.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain("updated content");
    expect(body.ref).toBeUndefined();
  });

  it("returns a clean 400/404 (not a 500) for an invalid/nonexistent ref", async () => {
    const path = join(".pHive", "planning", "prd.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}&ref=not-a-real-ref`,
    });
    expect([400, 404]).toContain(res.statusCode);
    const body = res.json();
    expect(body.error).toBeTruthy();
  });
});

describe("GET /api/docs/resolve", () => {
  let repoDir: string;
  let otherRepoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nhello world");

    otherRepoDir = mkdtempSync(join(tmpdir(), "consus-other-repo-"));
    mkdirSync(join(otherRepoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(otherRepoDir, ".pHive", "planning", "architecture.md"), "# Architecture\n\nother project doc");

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    scanRepo(db, { repoName: "other-project", repoPath: otherRepoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(otherRepoDir, { recursive: true, force: true });
  });

  it("resolves a real cross-repo candidate to the configured repo that has it", async () => {
    const text = "see .pHive/planning/architecture.md for the rationale";
    const res = await app.inject({ method: "GET", url: `/api/docs/resolve?text=${encodeURIComponent(text)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toEqual([
      { candidate: ".pHive/planning/architecture.md", resolved: true, repo: "other-project", path: ".pHive/planning/architecture.md" },
    ]);
  });

  it("reports a candidate that doesn't exist in any configured repo as unresolved, with a 200 (not a 500, not dropped)", async () => {
    const text = "see .pHive/planning/does-not-exist.md for details";
    const res = await app.inject({ method: "GET", url: `/api/docs/resolve?text=${encodeURIComponent(text)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toEqual([{ candidate: ".pHive/planning/does-not-exist.md", resolved: false }]);
  });
});

describe("GET /api/docs/search", () => {
  let repoDir: string;
  let otherRepoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "roadmap.md"), "# Plans\n\nnothing special here");

    otherRepoDir = mkdtempSync(join(tmpdir(), "consus-other-repo-"));
    mkdirSync(join(otherRepoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(
      join(otherRepoDir, ".pHive", "planning", "architecture.md"),
      "# Architecture\n\nthis mentions decision-request somewhere in the body",
    );

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    scanRepo(db, { repoName: "other-project", repoPath: otherRepoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(otherRepoDir, { recursive: true, force: true });
  });

  it("matches on repo name via a case-insensitive path/repo substring, tagging matched with 'path'", async () => {
    // "other-project" repo name contains "other"; "consus" doesn't.
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=other-proj" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      repo: "other-project",
      file_path: join(".pHive", "planning", "architecture.md"),
      matched: ["path"],
    });
  });

  it("matches a file_path substring case-insensitively (query 'ROADMAP' matches roadmap.md)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=ROADMAP" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      repo: "consus",
      file_path: join(".pHive", "planning", "roadmap.md"),
      matched: ["path"],
    });
  });

  it("matches on live file content when repo/file_path don't contain the query, tagging matched with 'content' only", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=decision-request" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      repo: "other-project",
      file_path: join(".pHive", "planning", "architecture.md"),
      matched: ["content"],
    });
  });

  it("appears exactly once, with matched containing both 'path' and 'content', when a doc matches both dimensions", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=architecture" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // "architecture" is in the file_path (path match) AND in the file
    // content via the "# Architecture" heading (case-insensitive content match).
    const matches = body.results.filter(
      (r: { repo: string; file_path: string }) =>
        r.repo === "other-project" && r.file_path === join(".pHive", "planning", "architecture.md"),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].matched.sort()).toEqual(["content", "path"]);
  });

  it("scopes both the path-match and content-match dimensions to a single project via ?project=", async () => {
    // "decision-request" only lives in other-project's content; scoping the
    // search to consus must suppress it on both dimensions, not just one.
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=decision-request&project=consus" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toEqual([]);

    // Sanity check: the same query against the actual owning project still matches.
    const res2 = await app.inject({
      method: "GET",
      url: "/api/docs/search?q=decision-request&project=other-project",
    });
    const body2 = res2.json();
    expect(body2.results).toHaveLength(1);
    expect(body2.results[0].repo).toBe("other-project");

    // Also verify project scoping suppresses a path match from the other repo.
    const res3 = await app.inject({ method: "GET", url: "/api/docs/search?q=other-proj&project=consus" });
    const body3 = res3.json();
    expect(body3.results).toEqual([]);
  });

  it("returns 400 when q is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when q is an empty string", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with an empty results array (not a 404) when nothing matches", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=nonexistent-string-xyz" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toEqual([]);
  });

  it("still returns 200 and skips only the content dimension when a doc_index row's file has been deleted from disk", async () => {
    const deletedPath = join(repoDir, ".pHive", "planning", "gone.md");
    writeFileSync(deletedPath, "# Gone\n\nsome ephemeral content only findable while it exists");
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    rmSync(deletedPath, { force: true });

    // Path match should still work off the stale index row.
    const pathRes = await app.inject({ method: "GET", url: "/api/docs/search?q=gone.md" });
    expect(pathRes.statusCode).toBe(200);
    const pathBody = pathRes.json();
    expect(pathBody.results).toHaveLength(1);
    expect(pathBody.results[0]).toMatchObject({
      repo: "consus",
      file_path: join(".pHive", "planning", "gone.md"),
      matched: ["path"],
    });

    // A content-only query against the now-deleted file's content must not
    // error the whole request — it simply can't match via content anymore.
    const contentRes = await app.inject({ method: "GET", url: "/api/docs/search?q=ephemeral" });
    expect(contentRes.statusCode).toBe(200);
    const contentBody = contentRes.json();
    expect(contentBody.results).toEqual([]);
  });
});
