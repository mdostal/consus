import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigration } from "../db/migrate.js";
import { registerDiagramRoutes } from "./diagrams.js";
import { setCachedDiagram } from "../db/diagrams-cache.js";
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

describe("GET /api/diagrams/repo/:repo_id/architecture", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let repoDir: string;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-arch-route-"));
  });

  afterEach(async () => {
    if (app) await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  function writeEpicDoc(epic: string, phase: string, fileName: string, content: string): void {
    const dir = join(repoDir, ".pHive", "epics", epic, phase);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileName), content);
  }

  it("returns a top-level Mermaid diagram built from the repo's .pHive docs", async () => {
    writeEpicDoc("alpha", "docs", "architecture.md", "# alpha");
    writeEpicDoc("bravo", "docs", "architecture.md", "# bravo");

    app = Fastify();
    registerDiagramRoutes(app, { db, client: makeClient({ ok: true, issues: [] }), repos: { consus: repoDir } });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/diagrams/repo/consus/architecture?level=top" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mermaid.split("\n")[0]).toBe("graph TD");
    expect(body.mermaid).toContain("alpha");
    expect(body.mermaid).toContain("bravo");
    expect(body.stale).toBe(false);
  });

  it("returns a full Mermaid diagram with components and dependency edges", async () => {
    writeEpicDoc("alpha", "planning", "brief.md", "# brief");
    writeEpicDoc("alpha", "docs", "architecture.md", "# architecture");

    app = Fastify();
    registerDiagramRoutes(app, { db, client: makeClient({ ok: true, issues: [] }), repos: { consus: repoDir } });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/diagrams/repo/consus/architecture?level=full" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mermaid).toContain("alpha / planning");
    expect(body.mermaid).toContain("alpha / docs");
    expect(body.mermaid).toMatch(/-->/);
  });

  it("serves the cached diagram without rescanning when .pHive docs are unchanged", async () => {
    writeEpicDoc("alpha", "docs", "architecture.md", "# alpha");

    app = Fastify();
    registerDiagramRoutes(app, { db, client: makeClient({ ok: true, issues: [] }), repos: { consus: repoDir } });
    await app.ready();

    const first = await app.inject({ method: "GET", url: "/api/diagrams/repo/consus/architecture?level=top" });
    expect(first.json().stale).toBe(false);

    // Mutate the mermaid source directly to prove the second request serves this cached value
    // rather than regenerating (docs on disk are unchanged).
    const cachedRow = db.prepare("SELECT * FROM diagrams WHERE diagram_type = 'repo-architecture-top'").get() as {
      mermaid_source: string;
    };
    db.prepare("UPDATE diagrams SET mermaid_source = ? WHERE diagram_type = 'repo-architecture-top'").run(
      "graph TD\n  z[\"sentinel-cached-value\"]"
    );

    const second = await app.inject({ method: "GET", url: "/api/diagrams/repo/consus/architecture?level=top" });
    expect(second.json().mermaid).toBe("graph TD\n  z[\"sentinel-cached-value\"]");
    expect(second.json().mermaid).not.toBe(cachedRow.mermaid_source);
  });

  it("regenerates and re-caches when the repo's .pHive docs change", async () => {
    writeEpicDoc("alpha", "docs", "architecture.md", "# alpha");

    app = Fastify();
    registerDiagramRoutes(app, { db, client: makeClient({ ok: true, issues: [] }), repos: { consus: repoDir } });
    await app.ready();

    const first = await app.inject({ method: "GET", url: "/api/diagrams/repo/consus/architecture?level=top" });
    expect(first.json().mermaid).toContain("alpha");
    expect(first.json().mermaid).not.toContain("bravo");

    writeEpicDoc("bravo", "docs", "architecture.md", "# bravo");

    const second = await app.inject({ method: "GET", url: "/api/diagrams/repo/consus/architecture?level=top" });
    expect(second.json().mermaid).toContain("bravo");
  });

  it("returns 404 for an unknown repo", async () => {
    app = Fastify();
    registerDiagramRoutes(app, { db, client: makeClient({ ok: true, issues: [] }), repos: {} });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/diagrams/repo/unknown/architecture" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("unknown");
  });
});
