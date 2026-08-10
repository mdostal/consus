import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { buildServer, parseRuntimeConfig, type ConsusMode, type PantheonPluginLifecycle } from "./index.js";
import { runMigration } from "./db/migrate.js";
import { scanRepo } from "./adapters/doc-scanner/index.js";
import type { MulticaClient, MulticaIssue } from "./adapters/multica/client.js";

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

function makeClient(issues: MulticaIssue[]): MulticaClient {
  return {
    async writeComment() {
      return { ok: false, error: "unused" };
    },
    async listIssues() {
      return { ok: true, issues };
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

function createFixture(): { rootDir: string; repoDir: string; dbPath: string } {
  const rootDir = mkdtempSync(join(tmpdir(), "consus-dual-mode-"));
  const repoDir = join(rootDir, "repo");
  const dbPath = join(rootDir, "consus.sqlite");

  mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
  writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nstandalone and plugin docs");
  mkdirSync(join(repoDir, ".pHive", "epics", "slice-2", "docs"), { recursive: true });
  writeFileSync(join(repoDir, ".pHive", "epics", "slice-2", "docs", "architecture.md"), "# Architecture\n\nmode test");
  writeFileSync(
    join(repoDir, ".pHive", "epics", "slice-2", "epic.yaml"),
    'name: slice-2\ntitle: "[slice-2] Consus usable"\nstories:\n  - id: disk-story\n    title: Disk-only story\n',
  );

  const db = new Database(dbPath);
  runMigration(db);
  scanRepo(db, { repoName: "consus", repoPath: repoDir });
  db.close();

  return { rootDir, repoDir, dbPath };
}

describe("runtime config", () => {
  it("defaults to standalone mode on :8722", () => {
    const config = parseRuntimeConfig(["node", "server/index.ts"], {});

    expect(config.mode).toBe("standalone");
    expect(config.port).toBe(8722);
  });

  it("parses explicit plugin mode and port flags", () => {
    const config = parseRuntimeConfig(["node", "server/index.ts", "--mode", "plugin", "--port", "9000"], {});

    expect(config.mode).toBe("plugin");
    expect(config.port).toBe(9000);
  });

  it("rejects unknown modes", () => {
    expect(() => parseRuntimeConfig(["node", "server/index.ts", "--mode", "embedded"], {})).toThrow(
      /Invalid Consus mode/,
    );
  });
});

describe.each(["standalone", "plugin"] as const)("%s mode integration", (mode: ConsusMode) => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) {
      rmSync(roots.pop()!, { recursive: true, force: true });
    }
  });

  it("serves health, docs, decision, and diagram endpoints", async () => {
    const fixture = createFixture();
    roots.push(fixture.rootDir);

    const lifecycle: Required<PantheonPluginLifecycle> = {
      onStart: vi.fn(),
      onStop: vi.fn(),
    };
    const client = makeClient([
      makeIssue({ id: "epic-1", title: "[slice-2] Consus usable", parentId: null }),
      makeIssue({ id: "story-1", identifier: "PAN-7961", title: "Dual-mode integration tests", parentId: "epic-1" }),
    ]);
    const app = buildServer({
      dbPath: fixture.dbPath,
      mode,
      repos: { consus: fixture.repoDir },
      client,
      pluginContext: { lifecycle },
    });

    await app.ready();

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", sqlite: "connected", mode });

    const healthz = await app.inject({ method: "GET", url: "/healthz" });
    expect(healthz.statusCode).toBe(200);
    expect(healthz.json()).toMatchObject({ status: "ok", sqlite: "connected", mode });

    const docs = await app.inject({ method: "GET", url: "/api/docs" });
    expect(docs.statusCode).toBe(200);
    expect(docs.json().consus.planning[0].file_path).toContain("prd.md");
    expect(docs.json().consus.docs[0]).toMatchObject({ epic: "slice-2" });

    const docContent = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(join(".pHive", "epics", "slice-2", "docs", "architecture.md"))}`,
    });
    expect(docContent.statusCode).toBe(200);
    expect(docContent.json()).toMatchObject({ repo: "consus", format: "md" });
    expect(docContent.json().content).toContain("mode test");

    const decisions = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(decisions.statusCode).toBe(200);
    expect(decisions.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Dual-mode integration tests" })]),
    );

    const diagram = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });
    expect(diagram.statusCode).toBe(200);
    expect(diagram.json().mermaid).toContain("Dual-mode integration tests");
    expect(diagram.json().mermaid).toContain("Disk-only story");

    await app.close();

    if (mode === "plugin") {
      expect(lifecycle.onStart).toHaveBeenCalledOnce();
      expect(lifecycle.onStop).toHaveBeenCalledOnce();
    } else {
      expect(lifecycle.onStart).not.toHaveBeenCalled();
      expect(lifecycle.onStop).not.toHaveBeenCalled();
    }

    expect(existsSync(fixture.dbPath)).toBe(true);
  });
});
