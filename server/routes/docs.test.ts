import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { registerDocRoutes } from "./docs.js";
import type { MulticaClient } from "../adapters/multica/client.js";

function docId(db: Database.Database, filePath = join(".pHive", "planning", "prd.md")): number {
  const row = db.prepare("SELECT id FROM doc_index WHERE file_path = ?").get(filePath) as { id: number };
  return row.id;
}

function makeClient(createIssue: MulticaClient["createIssue"]): MulticaClient {
  return {
    async writeComment() {
      return { ok: false, error: "unused" };
    },
    createIssue,
    async listIssues() {
      return { ok: true, issues: [] };
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

  it("fires a doc by creating a Multica issue with structured body and storing tracking fields", async () => {
    await app.close();
    const createIssue = vi.fn().mockResolvedValue({
      ok: true,
      issueId: "issue-123",
      issueUrl: "https://multica.example/issues/PAN-123",
    });
    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir }, client: makeClient(createIssue) });
    await app.ready();

    const res = await app.inject({ method: "POST", url: `/api/docs/${docId(db)}/fire` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      docId: docId(db),
      issueId: "issue-123",
      issueUrl: "https://multica.example/issues/PAN-123",
    });
    expect(createIssue).toHaveBeenCalledTimes(1);
    expect(createIssue).toHaveBeenCalledWith({
      title: "Fire doc: PRD",
      labels: ["consus:fired"],
      body: expect.stringContaining("## Doc: PRD"),
    });

    const body = createIssue.mock.calls[0][0].body;
    expect(body).toContain("**Type:** planning");
    expect(body).toContain("**Target Repo:** consus");
    expect(body).toContain("# PRD\n\nhello world");
    expect(body).toContain("Fired from Consus on ");

    const row = db.prepare("SELECT fired_at, multica_issue_id, multica_issue_url FROM doc_index WHERE id = ?").get(docId(db)) as {
      fired_at: string | null;
      multica_issue_id: string | null;
      multica_issue_url: string | null;
    };
    expect(row.fired_at).toEqual(expect.any(String));
    expect(row.multica_issue_id).toBe("issue-123");
    expect(row.multica_issue_url).toBe("https://multica.example/issues/PAN-123");
  });

  it("returns 503 when POST /api/docs/:id/fire is called without a configured Multica client", async () => {
    const res = await app.inject({ method: "POST", url: `/api/docs/${docId(db)}/fire` });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "Multica client not configured" });
  });

  it("prefers the latest doc_edits row over on-disk content when firing", async () => {
    db.prepare(
      "INSERT INTO doc_edits (id, repo, file_path, content, edited_by) VALUES (?, ?, ?, ?, ?)",
    ).run("e-test-1", "consus", join(".pHive", "planning", "prd.md"), "# Edited PRD\n\noperator version", "operator");
    await app.close();
    const createIssue = vi.fn().mockResolvedValue({
      ok: true,
      issueId: "issue-edited",
      issueUrl: "https://multica.example/issues/PAN-EDITED",
    });
    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir }, client: makeClient(createIssue) });
    await app.ready();

    const res = await app.inject({ method: "POST", url: `/api/docs/${docId(db)}/fire` });

    expect(res.statusCode).toBe(200);
    expect(createIssue.mock.calls[0][0].title).toBe("Fire doc: Edited PRD");
    expect(createIssue.mock.calls[0][0].body).toContain("# Edited PRD\n\noperator version");
    expect(createIssue.mock.calls[0][0].body).not.toContain("hello world");
  });

  it("creates a new issue on each fire even when the doc already has tracking fields", async () => {
    await app.close();
    const createIssue = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, issueId: "issue-1", issueUrl: "https://multica.example/issues/PAN-1" })
      .mockResolvedValueOnce({ ok: true, issueId: "issue-2", issueUrl: "https://multica.example/issues/PAN-2" });
    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir }, client: makeClient(createIssue) });
    await app.ready();

    await app.inject({ method: "POST", url: `/api/docs/${docId(db)}/fire` });
    const res = await app.inject({ method: "POST", url: `/api/docs/${docId(db)}/fire` });

    expect(res.statusCode).toBe(200);
    expect(createIssue).toHaveBeenCalledTimes(2);
    expect(res.json().issueId).toBe("issue-2");
    const row = db.prepare("SELECT multica_issue_id, multica_issue_url FROM doc_index WHERE id = ?").get(docId(db)) as {
      multica_issue_id: string;
      multica_issue_url: string;
    };
    expect(row.multica_issue_id).toBe("issue-2");
    expect(row.multica_issue_url).toBe("https://multica.example/issues/PAN-2");
  });

  it("does not mark a doc fired when Multica issue creation fails", async () => {
    await app.close();
    const createIssue = vi.fn().mockResolvedValue({ ok: false, error: "Multica returned HTTP 500" });
    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir }, client: makeClient(createIssue) });
    await app.ready();

    const res = await app.inject({ method: "POST", url: `/api/docs/${docId(db)}/fire` });

    expect(res.statusCode).toBe(502);
    const row = db.prepare("SELECT fired_at, multica_issue_id, multica_issue_url FROM doc_index WHERE id = ?").get(docId(db)) as {
      fired_at: string | null;
      multica_issue_id: string | null;
      multica_issue_url: string | null;
    };
    expect(row).toEqual({ fired_at: null, multica_issue_id: null, multica_issue_url: null });
  });
});

describe("GET /api/fired", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerDocRoutes(app, { db, repos: {} });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  function insertEdit(id: string, repo: string, filePath: string): void {
    db.prepare(
      "INSERT INTO doc_edits (id, repo, file_path, content, edited_by) VALUES (?, ?, ?, ?, ?)",
    ).run(id, repo, filePath, "content", "operator");
  }

  function insertFired(
    id: string,
    editId: string,
    multicaIssueId: string,
    targetRepo: string,
    firedBy: string,
    firedAt: string,
  ): void {
    db.prepare(
      "INSERT INTO fired_tickets (id, edit_id, multica_issue_id, target_repo, fired_by, fired_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, editId, multicaIssueId, targetRepo, firedBy, firedAt);
  }

  it("returns an empty list when no tickets have been fired", async () => {
    const res = await app.inject({ method: "GET", url: "/api/fired" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns fired_tickets joined with doc_edits, ordered by fired_at DESC", async () => {
    insertEdit("edit-1", "consus", "docs/a.md");
    insertEdit("edit-2", "consus", "docs/b.md");
    insertFired("ft-1", "edit-1", "PAN-1", "consus", "operator", "2026-08-01T00:00:00.000Z");
    insertFired("ft-2", "edit-2", "PAN-2", "consus", "operator", "2026-08-02T00:00:00.000Z");

    const res = await app.inject({ method: "GET", url: "/api/fired" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      id: "ft-2",
      multica_issue_id: "PAN-2",
      target_repo: "consus",
      fired_by: "operator",
      fired_at: "2026-08-02T00:00:00.000Z",
      repo: "consus",
      file_path: "docs/b.md",
    });
    expect(body[1]).toMatchObject({
      id: "ft-1",
      multica_issue_id: "PAN-1",
      repo: "consus",
      file_path: "docs/a.md",
    });
  });
});
