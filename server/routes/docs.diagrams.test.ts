import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { queryDocIndex, scanRepo } from "../adapters/doc-scanner/index.js";
import { registerDocRoutes } from "./docs.js";

// PANT-965: a repo's existing .mmd files are indexed as diagrams.
describe(".mmd diagrams in the doc index", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-mmd-"));
    mkdirSync(join(repoDir, "docs", "architecture"), { recursive: true });
    mkdirSync(join(repoDir, "design"), { recursive: true });
    mkdirSync(join(repoDir, "node_modules", "some-pkg"), { recursive: true });
    mkdirSync(join(repoDir, ".git"), { recursive: true });
    writeFileSync(join(repoDir, "docs", "architecture", "overview.md"), "# Overview\n");
    writeFileSync(join(repoDir, "docs", "architecture", "system.mmd"), "flowchart LR\n  a --> b\n");
    writeFileSync(join(repoDir, "design", "login.mmd"), "sequenceDiagram\n  A->>B: hi\n");
    writeFileSync(join(repoDir, "node_modules", "some-pkg", "vendored.mmd"), "flowchart LR\n");
    writeFileSync(join(repoDir, ".git", "stray.mmd"), "flowchart LR\n");

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "demo", repoPath: repoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { demo: repoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("indexes every .mmd in the repo as phase 'diagram', skipping node_modules and .git", () => {
    const diagrams = queryDocIndex(db, "demo").filter((r) => r.phase === "diagram");
    expect(diagrams.map((r) => r.file_path).sort()).toEqual([
      join("design", "login.mmd"),
      join("docs", "architecture", "system.mmd"),
    ]);
    expect(diagrams.every((r) => r.epic === null)).toBe(true);
  });

  it("leaves a .md alongside a .mmd tagged as an overview doc", () => {
    const md = queryDocIndex(db, "demo").find((r) => r.file_path === join("docs", "architecture", "overview.md"));
    expect(md?.phase).toBe("overview");
  });

  it("returns the diagrams in their own bucket from GET /api/docs/features", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/features?project=demo" });
    const body = res.json();
    expect(body.diagrams.map((d: { file_path: string }) => d.file_path).sort()).toEqual([
      join("design", "login.mmd"),
      join("docs", "architecture", "system.mmd"),
    ]);
    expect(body.overview.map((d: { file_path: string }) => d.file_path)).not.toContain(join("design", "login.mmd"));
  });

  it("serves .mmd content with format 'mmd' and a proposable item id", async () => {
    const path = join("docs", "architecture", "system.mmd");
    const res = await app.inject({ method: "GET", url: `/api/docs/content?repo=demo&path=${encodeURIComponent(path)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ format: "mmd", phase: "diagram", itemId: `doc:demo:${path}` });
    expect(res.json().content).toContain("a --> b");
  });
});
