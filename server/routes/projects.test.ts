import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { registerProjectRoutes } from "./projects.js";

describe("GET /api/projects", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerProjectRoutes(app, { db, repos: { consus: "/tmp/consus", other: "/tmp/other" } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("lists every registered project, independent of KB entries or ingest state", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ projects: ["consus", "other"] });
  });
});

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
    expect(res.json()).toEqual({ project: "consus", docsScanned: 1, eventsCreated: 1 });

    const row = db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get("consus") as { n: number };
    expect(row.n).toBe(1);
  });

  it("is idempotent — ingesting the same project twice does not duplicate doc_index rows or create further events", async () => {
    await app.inject({ method: "POST", url: "/api/projects/consus/ingest" });
    const second = await app.inject({ method: "POST", url: "/api/projects/consus/ingest" });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ project: "consus", docsScanned: 1, eventsCreated: 0 });

    const row = db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get("consus") as { n: number };
    expect(row.n).toBe(1);
  });

  it("returns 404 with an error naming the project for an unregistered project", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/does-not-exist/ingest" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown project: does-not-exist" });
  });

  it("AC11: produces the same events (trigger_kinds + count) as scan-all would for this one project — both share detectEvents", async () => {
    writeFileSync(
      join(repoDir, ".pHive", "planning", "decision.md"),
      [
        "# Decision",
        "",
        "```decision-request",
        JSON.stringify({
          version: "dostal:decision-request/v1",
          title: "Pick a queue",
          context: "context",
          options: [
            { id: "A", title: "SQS", tradeoffs: "managed" },
            { id: "B", title: "Redis streams", tradeoffs: "self-hosted" },
          ],
          recommended: "A",
        }),
        "```",
      ].join("\n"),
    );

    const res = await app.inject({ method: "POST", url: "/api/projects/consus/ingest" });
    const body = res.json();

    expect(body.docsScanned).toBe(2);
    expect(body.eventsCreated).toBe(3); // 2 new docs (doc_changed) + 1 decision_needed
    const events = db.prepare("SELECT trigger_kind FROM events").all() as Array<{ trigger_kind: string }>;
    expect(events.map((e) => e.trigger_kind).sort()).toEqual(["decision_needed", "doc_changed", "doc_changed"]);
  });
});

describe("POST /api/projects/scan-all", () => {
  let repoA: string;
  let repoB: string;
  let repoC: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoA = mkdtempSync(join(tmpdir(), "consus-scanall-a-"));
    mkdirSync(join(repoA, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoA, ".pHive", "planning", "doc.md"), "# A\n\ncontent a");

    repoB = mkdtempSync(join(tmpdir(), "consus-scanall-b-"));
    mkdirSync(join(repoB, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoB, ".pHive", "planning", "doc.md"), "# B\n\ncontent b");

    repoC = mkdtempSync(join(tmpdir(), "consus-scanall-c-"));
    mkdirSync(join(repoC, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoC, ".pHive", "planning", "doc.md"), "# C\n\ncontent c");

    db = new Database(":memory:");
    runMigration(db);

    // repo-b is scanned once while its directory exists (so doc_index has
    // rows for it, and its registry entry is "valid" at registry-load
    // time), then the directory is deleted out from under it — the exact
    // "repoPath is invalid (e.g. deleted after registry load)" scenario.
    scanRepo(db, { repoName: "b", repoPath: repoB });
    rmSync(repoB, { recursive: true, force: true });

    app = Fastify();
    registerProjectRoutes(app, { db, repos: { a: repoA, b: repoB, c: repoC } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoC, { recursive: true, force: true });
  });

  it("AC1: scans the healthy projects successfully, records the broken one as a failed result with a non-empty error, and still returns 200 overall", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/scan-all" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(3);

    const byProject = Object.fromEntries(body.results.map((r: { project: string }) => [r.project, r]));

    expect(byProject.a.ok).toBe(true);
    expect(byProject.a.docsScanned).toBe(1);
    expect(byProject.a.eventsCreated).toBe(1);

    expect(byProject.c.ok).toBe(true);
    expect(byProject.c.docsScanned).toBe(1);
    expect(byProject.c.eventsCreated).toBe(1);

    expect(byProject.b.ok).toBe(false);
    expect(typeof byProject.b.error).toBe("string");
    expect(byProject.b.error.length).toBeGreaterThan(0);
    expect(byProject.b.docsScanned).toBeUndefined();
    expect(byProject.b.eventsCreated).toBeUndefined();

    // The healthy projects' events genuinely exist in the DB, not just in
    // the response — a's and c's doc_index rows and events survive b's failure.
    const aEvents = db.prepare("SELECT COUNT(*) AS n FROM events WHERE project = ?").get("a") as { n: number };
    const cEvents = db.prepare("SELECT COUNT(*) AS n FROM events WHERE project = ?").get("c") as { n: number };
    expect(aEvents.n).toBe(1);
    expect(cEvents.n).toBe(1);
  });

  it("one project's failure does not abort the loop — the third project after the broken second one is still scanned", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/scan-all" });
    const body = res.json();
    const cResult = body.results.find((r: { project: string }) => r.project === "c");

    expect(cResult.ok).toBe(true);
  });
});
