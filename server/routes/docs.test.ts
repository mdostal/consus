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
    db.exec("ALTER TABLE doc_index ADD COLUMN editable_content TEXT");
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
