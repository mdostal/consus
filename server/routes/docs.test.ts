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
    expect(body.source).toBe("disk");
  });

  describe("PUT /api/docs/content", () => {
    it("creates doc_edits row and returns it via GET", async () => {
      const payload = {
        repo: "consus",
        path: ".pHive/epics/new-epic/doc.md",
        content: "# New Content",
        commit_to_disk: false,
      };
      
      const putRes = await app.inject({
        method: "PUT",
        url: "/api/docs/content",
        payload,
      });
      expect(putRes.statusCode).toBe(200);
      expect(putRes.json().committed).toBe(false);

      const row = db.prepare("SELECT * FROM doc_edits WHERE repo=? AND file_path=?").get("consus", ".pHive/epics/new-epic/doc.md") as any;
      expect(row).toBeDefined();
      expect(row.content).toBe("# New Content");
      expect(row.committed_to_disk).toBe(0);

      const getRes = await app.inject({
        method: "GET",
        url: "/api/docs/content?repo=consus&path=.pHive/epics/new-epic/doc.md",
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().content).toBe("# New Content");
      expect(getRes.json().source).toBe("edit");
    });

    it("writes to disk when commit_to_disk is true", async () => {
      const payload = {
        repo: "consus",
        path: ".pHive/epics/disk-epic/doc.md",
        content: "# Disk Content",
        commit_to_disk: true,
      };

      const putRes = await app.inject({
        method: "PUT",
        url: "/api/docs/content",
        payload,
      });
      expect(putRes.statusCode).toBe(200);
      expect(putRes.json().committed).toBe(true);

      const diskRes = await app.inject({
        method: "GET",
        url: "/api/docs/content?repo=consus&path=.pHive/epics/disk-epic/doc.md",
      });
      // source is 'edit' because doc_edits is still checked first and it was written there too
      expect(diskRes.json().source).toBe("edit");

      // Verify the disk file directly
      const fs = await import("node:fs/promises");
      const diskContent = await fs.readFile(join(repoDir, ".pHive/epics/disk-epic/doc.md"), "utf-8");
      expect(diskContent).toBe("# Disk Content");
    });

    it("returns 400 for invalid repo", async () => {
      const putRes = await app.inject({
        method: "PUT",
        url: "/api/docs/content",
        payload: { repo: "invalid-repo", path: ".pHive/epics/doc.md", content: "..." }
      });
      expect(putRes.statusCode).toBe(400);
    });

    it("returns 400 for path outside .pHive/epics", async () => {
      const putRes = await app.inject({
        method: "PUT",
        url: "/api/docs/content",
        payload: { repo: "consus", path: "src/index.ts", content: "..." }
      });
      expect(putRes.statusCode).toBe(400);
    });

    it("deduplicates identical edits", async () => {
      const payload = { repo: "consus", path: ".pHive/epics/dedup.md", content: "dedup content" };
      const res1 = await app.inject({ method: "PUT", url: "/api/docs/content", payload });
      const res2 = await app.inject({ method: "PUT", url: "/api/docs/content", payload });
      
      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
      expect(res2.json().deduped).toBe(true);
      expect(res2.json().edit_id).toBe(res1.json().edit_id);

      const rows = db.prepare("SELECT * FROM doc_edits WHERE repo=? AND file_path=?").all("consus", ".pHive/epics/dedup.md");
      expect(rows.length).toBe(1);
    });
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

  it("records a fired_tickets row when a doc is fired", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nhello world");
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    const createIssue = vi.fn().mockResolvedValue({
      ok: true,
      issueId: "issue-fire-1",
      issueUrl: "https://multica.example/issues/PAN-FIRE-1",
    });
    await app.close();
    app = Fastify();
    registerDocRoutes(app, {
      db,
      repos: { consus: repoDir },
      client: {
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
      },
    });
    await app.ready();

    const id = docId(db);
    await app.inject({ method: "POST", url: `/api/docs/${id}/fire` });

    const res = await app.inject({ method: "GET", url: "/api/fired" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      multica_issue_id: "issue-fire-1",
      target_repo: "consus",
      repo: "consus",
      file_path: join(".pHive", "planning", "prd.md"),
    });

    rmSync(repoDir, { recursive: true, force: true });
  });
});
