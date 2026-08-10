import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { readDocContent, scanRepo } from "../adapters/doc-scanner/index.js";
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

  it("prefers editable_content when that dependent edit column exists", async () => {
    db.prepare("UPDATE doc_index SET editable_content = ? WHERE id = ?").run("# Edited PRD\n\noperator version", docId(db));
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

describe("PUT /api/docs/content", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;
  const editablePath = join(".pHive", "epics", "some-epic", "docs", "design-discussion.md");

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    mkdirSync(join(repoDir, ".pHive", "epics", "some-epic", "docs"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "epics", "some-epic", "docs", "design-discussion.md"), "# Original\n\noriginal content");

    db = new Database(":memory:");
    runMigration(db);

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("creates a doc_edits row for a valid payload", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/docs/content",
      payload: { repo: "consus", path: editablePath, content: "# Edited\n\nnew content" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.edit_id).toEqual(expect.stringMatching(/^e-/));
    expect(body.committed).toBe(false);

    const row = db.prepare("SELECT repo, file_path, content, edited_by, committed_to_disk FROM doc_edits WHERE id = ?").get(body.edit_id);
    expect(row).toMatchObject({
      repo: "consus",
      file_path: editablePath,
      content: "# Edited\n\nnew content",
      edited_by: "consus",
      committed_to_disk: 0,
    });
  });

  it("writes to disk when commit_to_disk=true", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/docs/content",
      payload: { repo: "consus", path: editablePath, content: "# Committed\n\ndisk content", commit_to_disk: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().committed).toBe(true);

    const { content } = readDocContent(repoDir, editablePath);
    expect(content).toBe("# Committed\n\ndisk content");
  });

  it("does not touch disk when commit_to_disk=false", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/docs/content",
      payload: { repo: "consus", path: editablePath, content: "# Not committed\n\nsqlite only", commit_to_disk: false },
    });

    const { content } = readDocContent(repoDir, editablePath);
    expect(content).toBe("# Original\n\noriginal content");
  });

  it("returns 400 for an unknown repo", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/docs/content",
      payload: { repo: "does-not-exist", path: editablePath, content: "whatever" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "unknown repo: does-not-exist" });
  });

  it("returns 400 for a path outside .pHive/epics", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/docs/content",
      payload: { repo: "consus", path: join(".pHive", "planning", "prd.md"), content: "whatever" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "only .pHive/epics docs are editable" });
  });

  it("returns 400 for a path that traverses outside .pHive/epics via .. despite matching the prefix string", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/docs/content",
      payload: {
        repo: "consus",
        path: ".pHive/epics/../../outside.md",
        content: "malicious",
        commit_to_disk: true,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "only .pHive/epics docs are editable" });
    expect(existsSync(join(repoDir, "outside.md"))).toBe(false);
  });

  it("dedupes identical content into a single edit row", async () => {
    const payload = { repo: "consus", path: editablePath, content: "# Same\n\nsame content" };

    const first = await app.inject({ method: "PUT", url: "/api/docs/content", payload });
    const second = await app.inject({ method: "PUT", url: "/api/docs/content", payload });

    expect(first.json().edit_id).toBe(second.json().edit_id);
    expect(second.json().deduped).toBe(true);

    const count = db.prepare("SELECT COUNT(*) as n FROM doc_edits WHERE repo = ? AND file_path = ?").get("consus", editablePath) as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it("GET /api/docs/content returns the latest edit content when an edit exists", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/docs/content",
      payload: { repo: "consus", path: editablePath, content: "# Latest Edit\n\nedited content" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(editablePath)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("# Latest Edit\n\nedited content");
    expect(body.source).toBe("edit");
  });

  it("GET /api/docs/content falls back to disk when no edit exists", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(editablePath)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("# Original\n\noriginal content");
    expect(body.source).toBe("disk");
  });
});
