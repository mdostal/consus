import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { registerDocRoutes } from "../routes/docs.js";
import type { MulticaClient, CreateIssueInput, MulticaIssue } from "../adapters/multica/client.js";

/**
 * Flow 2 end-to-end: edit a .pHive doc through Consus's real API surface,
 * fire it to create a Multica issue, and confirm a hive-plugin poll
 * (client.listIssues()) would pick the issue up with the edited content as
 * build context. Runs against a real Fastify app + real SQLite file, with
 * only the Multica boundary stubbed (per design_decisions in PAN-8231).
 */
const DOC_PATH = join(".pHive", "epics", "demo-epic", "design", "discussion.md");

function makeMulticaStub(): MulticaClient & {
  createdIssues: Array<CreateIssueInput & { id: string; url: string }>;
} {
  const createdIssues: Array<CreateIssueInput & { id: string; url: string }> = [];
  return {
    createdIssues,
    async writeComment() {
      return { ok: false, error: "unused" };
    },
    async createIssue(input) {
      const id = `issue-${createdIssues.length + 1}`;
      const url = `https://multica.test/issues/${id}`;
      createdIssues.push({ ...input, id, url });
      return { ok: true, issueId: id, issueUrl: url };
    },
    async listIssues() {
      const issues: MulticaIssue[] = createdIssues.map((created) => ({
        id: created.id,
        identifier: created.id,
        title: created.title,
        description: created.body,
        status: "todo",
        priority: null,
        labels: created.labels ?? [],
        updatedAt: null,
        createdAt: null,
        parentId: null,
      }));
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

describe("Flow 2 E2E — edit doc, fire, hive pickup", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;
  let client: ReturnType<typeof makeMulticaStub>;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-flow2-"));
    mkdirSync(join(repoDir, ".pHive", "epics", "demo-epic", "design"), { recursive: true });
    writeFileSync(join(repoDir, DOC_PATH), "# Design Discussion\n\nOriginal design discussion content");

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "demo-repo", repoPath: repoDir });

    client = makeMulticaStub();
    app = Fastify();
    registerDocRoutes(app, { db, repos: { "demo-repo": repoDir }, client });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  function docId(): number {
    const row = db.prepare("SELECT id FROM doc_index WHERE file_path = ?").get(DOC_PATH) as { id: number };
    return row.id;
  }

  it("completes edit -> fire -> hive pickup, carrying the edited content as build context", async () => {
    const id = docId();

    const editedContent = "# Design Discussion (revised)\n\nUpdated design discussion content";

    // 1. Edit the doc — persists to SQLite (AC1)
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/docs/${id}`,
      payload: { content: editedContent, edited_by: "human" },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({ method: "GET", url: `/api/docs/${id}` });
    expect(getRes.json().content).toBe(editedContent);

    // 2. Fire the doc — creates a Multica issue with structured body (AC2/AC3)
    const fireRes = await app.inject({ method: "POST", url: `/api/docs/${id}/fire` });
    expect(fireRes.statusCode).toBe(200);
    const { issueId, issueUrl } = fireRes.json();
    expect(issueId).toBeDefined();
    expect(issueUrl).toBeDefined();

    expect(client.createdIssues).toHaveLength(1);
    const [created] = client.createdIssues;
    expect(created.title).toContain("Design Discussion (revised)");
    expect(created.labels).toEqual(["consus:fired"]);
    expect(created.body).toContain("Fired from Consus");
    expect(created.body).toContain("**Target Repo:** demo-repo");

    // AC3/AC4: the fired issue must carry the edited content as build
    // context, not the stale on-disk copy — this is what makes Flow 2 a
    // real edit -> fire -> build loop instead of always firing the original.
    expect(created.body).toContain("Updated design discussion content");

    // fired tracking columns persisted (AC2)
    const docRow = db
      .prepare("SELECT fired_at, multica_issue_id, multica_issue_url FROM doc_index WHERE id = ?")
      .get(id) as { fired_at: string | null; multica_issue_id: string | null; multica_issue_url: string | null };
    expect(docRow.fired_at).toEqual(expect.any(String));
    expect(docRow.multica_issue_id).toBe(issueId);
    expect(docRow.multica_issue_url).toBe(issueUrl);

    // 3. Simulate hive plugin pickup — it polls Multica via listIssues() (AC3)
    const { issues } = await client.listIssues();
    expect(issues).toContainEqual(expect.objectContaining({ id: issueId, status: "todo" }));
    const pickedUp = issues.find((i) => i.id === issueId)!;
    expect(pickedUp.description).toContain("Updated design discussion content");
  });

  it("returns 503 and creates no issue when the Multica client is unconfigured", async () => {
    const unconfiguredApp = Fastify();
    registerDocRoutes(unconfiguredApp, { db, repos: { "demo-repo": repoDir } });
    await unconfiguredApp.ready();

    const res = await unconfiguredApp.inject({ method: "POST", url: `/api/docs/${docId()}/fire` });
    expect(res.statusCode).toBe(503);
    expect(client.createdIssues).toHaveLength(0);

    await unconfiguredApp.close();
  });
});
