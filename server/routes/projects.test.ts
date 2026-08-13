import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerProjectRoutes } from "./projects.js";

describe("POST /api/projects/:project/ingest", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-ingest-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "architecture.md"), "# Architecture\n\nplan content");

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

  it("scans a registered project's docs on disk and reports the correct count", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/consus/ingest" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ project: "consus", docsScanned: 1 });

    const row = db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get("consus") as { n: number };
    expect(row.n).toBe(1);
  });

  it("is idempotent — ingesting the same project twice does not duplicate rows", async () => {
    await app.inject({ method: "POST", url: "/api/projects/consus/ingest" });
    const second = await app.inject({ method: "POST", url: "/api/projects/consus/ingest" });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ project: "consus", docsScanned: 1 });

    const row = db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get("consus") as { n: number };
    expect(row.n).toBe(1);
  });

  it("returns 404 with an error naming the project for an unregistered project", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/does-not-exist/ingest" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown project: does-not-exist" });
  });
});
