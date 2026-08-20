import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerProjectRoutes } from "./projects.js";

/**
 * s4-branch-picker-ui: GET /api/projects/:project/branches — backs the web
 * UI's branch picker. Reuses the temp-git-fixture pattern already
 * established by projects.ref-ingest.test.ts / git-ref.test.ts.
 */

function git(repoDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf-8" });
}

describe("GET /api/projects/:project/branches", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-branches-route-"));
    git(repoDir, ["init", "-b", "main"]);
    git(repoDir, ["config", "user.email", "test@example.com"]);
    git(repoDir, ["config", "user.name", "Test"]);
    git(repoDir, ["commit", "--allow-empty", "-m", "initial"]);

    git(repoDir, ["checkout", "-b", "feature/branch-doc"]);
    git(repoDir, ["commit", "--allow-empty", "-m", "branch commit"]);
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

  it("returns 404 with an error naming the project for an unregistered project", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/does-not-exist/branches" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown project: does-not-exist" });
  });

  it("lists both branches for a repo with a non-default branch", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/consus/branches" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.branches).toContain("main");
    expect(body.branches).toContain("feature/branch-doc");
  });

  it("AC5: gracefully returns just the current branch (no error, no crash) for a repo with zero non-default branches", async () => {
    const soloRepoDir = mktempSoloRepo();

    const soloApp = Fastify();
    registerProjectRoutes(soloApp, { db, repos: { solo: soloRepoDir } });
    await soloApp.ready();

    const res = await soloApp.inject({ method: "GET", url: "/api/projects/solo/branches" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ branches: ["main"] });

    await soloApp.close();
    rmSync(soloRepoDir, { recursive: true, force: true });
  });

  function mktempSoloRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "consus-branches-route-solo-"));
    git(dir, ["init", "-b", "main"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    git(dir, ["commit", "--allow-empty", "-m", "initial"]);
    return dir;
  }
});
