import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerProjectRoutes } from "./projects.js";

// s3 (consus-phase25-project-registration-ux): GET /api/projects/discover
// resolves candidate root directories from (a) the parent directory of every
// already-registered project's path and (b) an optional
// CONSUS_DISCOVERY_ROOTS-sourced list, threaded through as `discoveryRoots`.
// It reuses s2's listSubdirectories directly (server/routes/fs.ts) rather
// than duplicating readdir/isRepo detection.
describe("GET /api/projects/discover", () => {
  let workDir: string;
  let db: Database.Database;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "consus-discover-"));
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(async () => {
    if (app) await app.close();
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  async function buildApp(options: {
    repos: Record<string, string>;
    discoveryRoots?: string[];
  }): Promise<FastifyInstance> {
    const built = Fastify();
    registerProjectRoutes(built, { db, ...options });
    await built.ready();
    app = built;
    return built;
  }

  it("includes sibling directories of a registered project's path that look like repos", async () => {
    // parentDir/
    //   consus/            <- registered project
    //   sibling-repo/.git  <- candidate
    //   plain-dir/         <- not a repo, excluded
    const parentDir = mkdtempSync(join(workDir, "parent-"));
    const consusDir = join(parentDir, "consus");
    mkdirSync(consusDir);
    mkdirSync(join(parentDir, "sibling-repo"));
    mkdirSync(join(parentDir, "sibling-repo", ".git"));
    mkdirSync(join(parentDir, "plain-dir"));

    const built = await buildApp({ repos: { consus: consusDir } });
    const res = await built.inject({ method: "GET", url: "/api/projects/discover" });

    expect(res.statusCode).toBe(200);
    const { candidates } = res.json();
    expect(candidates).toEqual([{ name: "sibling-repo", path: join(parentDir, "sibling-repo") }]);
  });

  it("includes CONSUS_DISCOVERY_ROOTS-sourced subdirectories regardless of what's registered", async () => {
    const extraRoot = mkdtempSync(join(workDir, "extra-"));
    mkdirSync(join(extraRoot, "found-repo"));
    mkdirSync(join(extraRoot, "found-repo", ".pHive"));

    // registered project lives entirely elsewhere, unrelated to extraRoot.
    const registeredDir = mkdtempSync(join(workDir, "registered-"));
    mkdirSync(join(registeredDir, "some-project"));

    const built = await buildApp({
      repos: { "some-project": join(registeredDir, "some-project") },
      discoveryRoots: [extraRoot],
    });
    const res = await built.inject({ method: "GET", url: "/api/projects/discover" });

    expect(res.statusCode).toBe(200);
    const { candidates } = res.json();
    expect(candidates).toEqual([{ name: "found-repo", path: join(extraRoot, "found-repo") }]);
  });

  it("excludes a directory that is already a registered project's path", async () => {
    const parentDir = mkdtempSync(join(workDir, "parent-"));
    const consusDir = join(parentDir, "consus");
    const alreadyRegisteredDir = join(parentDir, "already-registered");
    mkdirSync(consusDir);
    mkdirSync(alreadyRegisteredDir);
    mkdirSync(join(alreadyRegisteredDir, ".git"));

    const built = await buildApp({
      repos: { consus: consusDir, other: alreadyRegisteredDir },
    });
    const res = await built.inject({ method: "GET", url: "/api/projects/discover" });

    expect(res.statusCode).toBe(200);
    const { candidates } = res.json();
    expect(candidates).toEqual([]);
  });

  it("deduplicates a directory reachable via both sibling-discovery and CONSUS_DISCOVERY_ROOTS", async () => {
    const parentDir = mkdtempSync(join(workDir, "parent-"));
    const consusDir = join(parentDir, "consus");
    mkdirSync(consusDir);
    mkdirSync(join(parentDir, "sibling-repo"));
    mkdirSync(join(parentDir, "sibling-repo", ".git"));

    const built = await buildApp({
      repos: { consus: consusDir },
      // Explicitly names the same parent directory sibling-discovery
      // already resolves — the candidate must appear exactly once.
      discoveryRoots: [parentDir],
    });
    const res = await built.inject({ method: "GET", url: "/api/projects/discover" });

    expect(res.statusCode).toBe(200);
    const { candidates } = res.json();
    expect(candidates).toEqual([{ name: "sibling-repo", path: join(parentDir, "sibling-repo") }]);
  });

  it("returns an empty candidates array, not an error, when there are no registered projects and no discoveryRoots", async () => {
    const built = await buildApp({ repos: {} });
    const res = await built.inject({ method: "GET", url: "/api/projects/discover" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ candidates: [] });
  });
});
