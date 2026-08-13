import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerIterateRoutes } from "./iterate.js";
import type { MulticaClient, MulticaIssue } from "../adapters/multica/client.js";

function issue(overrides: Partial<MulticaIssue> = {}): MulticaIssue {
  return {
    id: "i-1",
    identifier: "DOS-1",
    title: "Ship v1?",
    description: "body",
    status: "todo",
    priority: null,
    labels: [],
    updatedAt: null,
    createdAt: null,
    parentId: null,
    ...overrides,
  };
}

function fakeClient(overrides: Partial<MulticaClient> = {}): MulticaClient {
  return {
    writeComment: async () => ({ ok: true, multicaCommentId: "mc-1" }),
    listIssues: async () => ({ ok: true, issues: [] }),
    getIssue: async () => ({ ok: true, issue: issue() }),
    updateIssueStatus: async () => ({ ok: true, status: "in_progress" }),
    ...overrides,
  };
}

describe("POST /api/decisions/:key/iterate", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    dir = mkdtempSync(join(tmpdir(), "consus-iterate-"));
    logPath = join(dir, "decision-log.jsonl");
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function build(client: MulticaClient) {
    app = Fastify();
    registerIterateRoutes(app, { db, client, decisionLogPath: logPath });
    await app.ready();
  }

  it("posts a comment with no mention line when no agentId/agentName is given, and logs agent: null", async () => {
    let sentBody = "";
    await build(fakeClient({ writeComment: async (input) => { sentBody = input.body; return { ok: true, multicaCommentId: "mc-1" }; } }));

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/i-1/iterate",
      payload: { prompt: "please redo this" },
    });

    expect(res.statusCode).toBe(200);
    expect(sentBody).not.toContain("mention://agent/");
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.comment_id).toBe("mc-1");
  });

  it("includes the exact mention line when agentId and agentName are both given", async () => {
    let sentBody = "";
    await build(fakeClient({ writeComment: async (input) => { sentBody = input.body; return { ok: true, multicaCommentId: "mc-1" }; } }));

    await app.inject({
      method: "POST",
      url: "/api/decisions/i-1/iterate",
      payload: { prompt: "please redo this", agentId: "agent-1", agentName: "researcher" },
    });

    expect(sentBody).toContain("[@researcher](mention://agent/agent-1)");
  });

  it("400s and posts nothing when prompt is missing or empty", async () => {
    let called = false;
    await build(fakeClient({ writeComment: async () => { called = true; return { ok: true, multicaCommentId: "mc-1" }; } }));

    const res = await app.inject({ method: "POST", url: "/api/decisions/i-1/iterate", payload: { prompt: "" } });

    expect(res.statusCode).toBe(400);
    expect(called).toBe(false);
  });

  it("writes NO log entry when the Multica comment write fails — never a false-success log", async () => {
    await build(fakeClient({ writeComment: async () => ({ ok: false, error: "ECONNREFUSED" }) }));

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/i-1/iterate",
      payload: { prompt: "please redo this" },
    });

    expect(res.statusCode).toBe(502);

    const logRes = await app.inject({ method: "GET", url: "/api/log" });
    expect(logRes.json()).toEqual([]);
  });

  it("includes scope.section/scope.diagram context lines when provided, omitted when not", async () => {
    let sentBody = "";
    await build(fakeClient({ writeComment: async (input) => { sentBody = input.body; return { ok: true, multicaCommentId: "mc-1" }; } }));

    await app.inject({
      method: "POST",
      url: "/api/decisions/i-1/iterate",
      payload: { prompt: "p", scope: { section: "risks" } },
    });

    expect(sentBody).toContain("section: risks");
  });

  it("PUTs the issue's status via the client when setInProgress is true, and logs before/after", async () => {
    let statusCallArgs: [string, string] | null = null;
    await build(
      fakeClient({
        updateIssueStatus: async (id, status) => {
          statusCallArgs = [id, status];
          return { ok: true, status };
        },
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/i-1/iterate",
      payload: { prompt: "p", setInProgress: true },
    });

    expect(res.statusCode).toBe(200);
    expect(statusCallArgs).toEqual(["i-1", "in_progress"]);

    const logRes = await app.inject({ method: "GET", url: "/api/log" });
    const entries = logRes.json();
    expect(entries[0].status_set).toBe("in_progress");
    expect(entries[0].previous_status).toBe("todo"); // the fake issue's original status
  });

  it("strips a multica: prefix from :key before calling the Multica client", async () => {
    let requestedKey = "";
    await build(fakeClient({ getIssue: async (key) => { requestedKey = key; return { ok: true, issue: issue() }; } }));

    await app.inject({ method: "POST", url: "/api/decisions/multica:i-1/iterate", payload: { prompt: "p" } });

    expect(requestedKey).toBe("i-1");
  });
});

describe("GET /api/log", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    dir = mkdtempSync(join(tmpdir(), "consus-iterate-log-"));
    logPath = join(dir, "decision-log.jsonl");
    app = Fastify();
    registerIterateRoutes(app, {
      db,
      client: fakeClient({ getIssue: async (key) => ({ ok: true, issue: issue({ id: key }) }) }),
      decisionLogPath: logPath,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when nothing has been logged yet", async () => {
    const res = await app.inject({ method: "GET", url: "/api/log" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns entries most-recent-first, capped by ?limit=", async () => {
    await app.inject({ method: "POST", url: "/api/decisions/i-1/iterate", payload: { prompt: "first" } });
    await app.inject({ method: "POST", url: "/api/decisions/i-1/iterate", payload: { prompt: "second" } });

    const res = await app.inject({ method: "GET", url: "/api/log?limit=1" });
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].prompt).toBe("second");
  });

  it("filters to one issue's requests via ?issueId= (the Versions view's query)", async () => {
    await app.inject({ method: "POST", url: "/api/decisions/i-1/iterate", payload: { prompt: "for i-1" } });
    await app.inject({ method: "POST", url: "/api/decisions/i-2/iterate", payload: { prompt: "for i-2" } });

    const res = await app.inject({ method: "GET", url: "/api/log?issueId=i-1" });
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].prompt).toBe("for i-1");
  });
});
