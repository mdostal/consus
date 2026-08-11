import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigration } from "../db/migrate.js";
import { registerDiagramRoutes } from "./diagrams.js";
import { getCachedDiagram, setCachedDiagram } from "../db/diagrams-cache.js";
import type { MulticaClient, MulticaIssue, MulticaListResult } from "../adapters/multica/client.js";

function makeIssue(overrides: Partial<MulticaIssue> = {}): MulticaIssue {
  return {
    id: "issue-1",
    identifier: "PAN-1",
    title: "Some issue",
    description: null,
    status: "todo",
    priority: "none",
    labels: [],
    updatedAt: null,
    createdAt: null,
    parentId: null,
    ...overrides,
  };
}

function makeClient(listIssuesResult: MulticaListResult): MulticaClient {
  return {
    async writeComment() {
      return { ok: false, error: "unused" };
    },
    async createIssue() {
      return { ok: false, error: "unused" };
    },
    async listIssues() {
      return listIssuesResult;
    },
    async getIssue() {
      return { ok: false, error: "unused" };
    },
    async updateIssueStatus() {
      return { ok: false, error: "unused" };
    },
    async unblockIssue() {
      return { ok: false, error: "unused" };
    },
  };
}

describe("GET /api/diagrams/cascade", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let repoDir: string;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    repoDir = mkdtempSync(join(tmpdir(), "consus-diagrams-route-"));
    mkdirSync(join(repoDir, ".pHive", "epics"), { recursive: true });
  });

  afterEach(async () => {
    if (app) await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns valid Mermaid graph LR markup built from the live Multica org tree", async () => {
    const client = makeClient({
      ok: true,
      issues: [
        makeIssue({ id: "epic-1", title: "[slice-2] Consus usable", parentId: null }),
        makeIssue({ id: "story-1", identifier: "PAN-2", title: "Cascade org-tree diagram endpoint", parentId: "epic-1" }),
      ],
    });

    app = Fastify();
    registerDiagramRoutes(app, { db, client, repos: { consus: repoDir } });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mermaid.split("\n")[0]).toBe("graph LR");
    expect(body.mermaid).toContain("[slice-2] Consus usable");
    expect(body.mermaid).toContain("Cascade org-tree diagram endpoint");
    expect(body.mermaid).toMatch(/-->/);
    expect(body.stale).toBe(false);
  });

  it("nests stories under their parent epic in the rendered tree", async () => {
    const client = makeClient({
      ok: true,
      issues: [
        makeIssue({ id: "epic-1", title: "[slice-2] Consus usable", parentId: null }),
        makeIssue({ id: "story-1", identifier: "PAN-2", title: "Story A", parentId: "epic-1" }),
        makeIssue({ id: "unrelated", title: "Unrelated top-level issue", parentId: null }),
      ],
    });

    app = Fastify();
    registerDiagramRoutes(app, { db, client, repos: {} });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });
    const body = res.json();

    const epicLine = body.mermaid.split("\n").find((l: string) => l.includes("[slice-2] Consus usable"));
    const epicId = epicLine.match(/^\s*(\S+)\[/)[1];
    const storyLine = body.mermaid.split("\n").find((l: string) => l.includes("Story A"));
    const storyId = storyLine.match(/^\s*(\S+)\[/)[1];

    expect(body.mermaid).toContain(`${epicId} --> ${storyId}`);
  });

  it("serves the cached diagram without re-fetching Multica when still fresh", async () => {
    setCachedDiagram(db, null, "cascade", "graph LR\n  a[\"cached\"]");
    const listIssues = vi.fn();
    const client: MulticaClient = { ...makeClient({ ok: true, issues: [] }), listIssues };

    app = Fastify();
    registerDiagramRoutes(app, { db, client, repos: {} });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });

    expect(res.statusCode).toBe(200);
    expect(res.json().mermaid).toBe('graph LR\n  a["cached"]');
    expect(listIssues).not.toHaveBeenCalled();
  });

  it("falls back to a stale cached diagram when the live Multica fetch fails", async () => {
    const db2 = db;
    setCachedDiagram(db2, null, "cascade", "graph LR\n  a[\"stale\"]");
    // Force staleness by rewriting cached_at far in the past.
    db2.prepare("UPDATE diagrams SET cached_at = '2000-01-01T00:00:00.000Z' WHERE diagram_type = 'cascade'").run();

    const client = makeClient({ ok: false, error: "Multica returned HTTP 503" });

    app = Fastify();
    registerDiagramRoutes(app, { db, client, repos: {} });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mermaid).toBe('graph LR\n  a["stale"]');
    expect(body.stale).toBe(true);
  });

  it("returns 502 when Multica fails and there is no cache to fall back on", async () => {
    const client = makeClient({ ok: false, error: "Multica returned HTTP 503" });

    app = Fastify();
    registerDiagramRoutes(app, { db, client, repos: {} });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("503");
  });
});

describe("GET /api/diagrams/:repo", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-diagram-route-"));
    mkdirSync(join(repoDir, "server"));
    mkdirSync(join(repoDir, "web"));

    db = new Database(":memory:");
    runMigration(db);

    const client = makeClient({ ok: true, issues: [] });
    app = Fastify();
    registerDiagramRoutes(app, { db, client, repos: { consus: repoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns topLevel and fullComponent Mermaid markup for a known repo", async () => {
    const res = await app.inject({ method: "GET", url: "/api/diagrams/consus" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.topLevel).toBe("string");
    expect(typeof body.fullComponent).toBe("string");
    expect(body.topLevel.startsWith("graph TD")).toBe(true);
    expect(body.fullComponent.startsWith("graph TD")).toBe(true);
  });

  it("returns 404 if repo is not in the project registry", async () => {
    const res = await app.inject({ method: "GET", url: "/api/diagrams/unknown-repo" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("unknown-repo");
  });

  it("caches the generated diagrams so a second request reads from the diagrams cache", async () => {
    const first = await app.inject({ method: "GET", url: "/api/diagrams/consus" });
    expect(first.statusCode).toBe(200);

    const cachedTop = getCachedDiagram(db, "consus", "topLevel");
    const cachedFull = getCachedDiagram(db, "consus", "fullComponent");
    expect(cachedTop?.mermaid_source).toBe(first.json().topLevel);
    expect(cachedFull?.mermaid_source).toBe(first.json().fullComponent);

    mkdirSync(join(repoDir, "new-dir-added-after-first-request"));
    const second = await app.inject({ method: "GET", url: "/api/diagrams/consus" });
    expect(second.json()).toEqual(first.json());
    expect(second.json().topLevel).not.toContain("new-dir-added-after-first-request");
  });
});
