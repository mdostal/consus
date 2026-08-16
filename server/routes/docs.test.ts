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
