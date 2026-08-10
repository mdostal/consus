import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigration } from "../db/migrate.js";
import { registerDecisionRoutes } from "./decisions.js";
import { registerKbRoutes } from "./kb.js";
import { decideItem } from "../kb/store.js";
import type { MulticaClient, MulticaIssue, MulticaListResult } from "../adapters/multica/client.js";

function insertItem(db: Database.Database, id: string, payload: string | null, decided = false) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", `Item ${id}`, "open", now, now, payload);
  if (decided) {
    decideItem(db, { itemId: id, actor: "mathew", newStatus: "approved" });
  }
}

const PAYLOAD = JSON.stringify({
  version: "dostal:decision-request/v1",
  title: "q",
  context: "",
  options: [
    { id: "A", title: "Yes", tradeoffs: "" },
    { id: "B", title: "No", tradeoffs: "" },
  ],
  recommended: "A",
});

function makeIssue(overrides: Partial<MulticaIssue> = {}): MulticaIssue {
  return {
    id: "issue-1",
    identifier: "MUL-1",
    title: "Some issue",
    description: null,
    status: "in_review",
    priority: "none",
    labels: [],
    updatedAt: null,
    createdAt: null,
    parentId: null,
    ...overrides,
  };
}

/** Fake MulticaClient — resolves with whatever `result` currently holds, so a
 *  test can swap the response (e.g. simulate a fetch failure) after setup. */
function fakeClient(result: MulticaListResult, overrides: Partial<MulticaClient> = {}): MulticaClient {
  return {
    async writeComment() {
      return { ok: true, multicaCommentId: "unused" };
    },
    async listIssues() {
      return result;
    },
    async getIssue() {
      return { ok: true, issue: makeIssue() };
    },
    async updateIssueStatus(_issueId: string, status: string) {
      return { ok: true, status };
    },
    async unblockIssue(_issueId: string) {
      return { ok: true, status: "todo" };
    },
    ...overrides,
  };
}

const EMPTY_CLIENT = fakeClient({ ok: true, issues: [] });

describe("GET /api/decisions", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerDecisionRoutes(app, { db, client: EMPTY_CLIENT });
    registerKbRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("lists every open item carrying a decision_payload", async () => {
    insertItem(db, "item-1", PAYLOAD);
    insertItem(db, "item-2", PAYLOAD);
    insertItem(db, "item-3", null); // no decision_payload — not a decision

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id).sort()).toEqual(["item-1", "item-2"]);
  });

  it("excludes decided items — the decided-store amnesia fix applies to the API too", async () => {
    insertItem(db, "item-4", PAYLOAD);
    insertItem(db, "item-5", PAYLOAD, true);

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id)).toEqual(["item-4"]);
  });

  it("parses decision_payload into the response rather than leaving it as a raw JSON string", async () => {
    insertItem(db, "item-6", PAYLOAD);

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body[0].decision_payload).toEqual(JSON.parse(PAYLOAD));
  });

  it("?all=1 includes decided items alongside open ones", async () => {
    insertItem(db, "item-7", PAYLOAD);
    insertItem(db, "item-8", PAYLOAD, true);

    const res = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    const body = res.json();

    expect(body.map((i: { id: string }) => i.id).sort()).toEqual(["item-7", "item-8"]);
  });

  it("AC2 e2e: an item moves from the open queue to ?all=1-only after a real POST verdict", async () => {
    insertItem(db, "item-9", PAYLOAD);

    const before = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(before.json().map((i: { id: string }) => i.id)).toEqual(["item-9"]);

    const verdict = await app.inject({
      method: "POST",
      url: "/api/items/item-9/decide",
      payload: { actor: "mathew", newStatus: "approved" },
    });
    expect(verdict.statusCode).toBe(200);

    const openAfter = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(openAfter.json()).toEqual([]);

    const allAfter = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    expect(allAfter.json().map((i: { id: string }) => i.id)).toEqual(["item-9"]);
  });
});

describe("POST /api/decisions/:key/iterate + GET /api/log", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let tmpDir: string;
  let logPath: string;

  const issue = makeIssue({
    id: "issue-iterate",
    identifier: "PAN-1",
    title: "Choose the durable route",
    status: "todo",
  });

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    tmpDir = mkdtempSync(join(tmpdir(), "consus-iterate-test-"));
    logPath = join(tmpDir, "decision-log.jsonl");
  });

  afterEach(async () => {
    if (app) await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function buildApp(client: MulticaClient) {
    app = Fastify();
    registerDecisionRoutes(app, { db, client, decisionLogPath: logPath });
    await app.ready();
  }

  function cachedComments() {
    return db.prepare("SELECT * FROM comments ORDER BY id ASC").all() as Array<{
      item_id: string;
      author: string;
      body: string;
      multica_comment_id: string;
    }>;
  }

  it("posts an iterate request through writeCommentAndCache without a mention line and logs agent null", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: true, multicaCommentId: "comment-1" });
    await buildApp(
      fakeClient(
        { ok: true, issues: [] },
        {
          writeComment,
          async getIssue() {
            return { ok: true, issue };
          },
        },
      ),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/PAN-1/iterate",
      payload: { prompt: "Please revisit the tradeoff.", actor: "mathew" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, comment_id: "comment-1" });
    expect(writeComment).toHaveBeenCalledTimes(1);
    expect(writeComment.mock.calls[0][0]).toEqual({
      itemId: "issue-iterate",
      author: "mathew",
      body: expect.any(String),
    });
    const commentBody = writeComment.mock.calls[0][0].body;
    expect(commentBody).toContain("Please revisit the tradeoff.");
    expect(commentBody).not.toContain("mention://agent/");
    expect(cachedComments()[0]).toMatchObject({
      item_id: "multica:issue-iterate",
      multica_comment_id: "comment-1",
    });

    const log = await app.inject({ method: "GET", url: "/api/log" });
    expect(log.json()[0]).toMatchObject({
      verdict: "iterate",
      prompt: "Please revisit the tradeoff.",
      agent: null,
      comment_id: "comment-1",
      previous_status: null,
      status_set: null,
    });
  });

  it("includes the exact Multica agent mention line when agentId and agentName are both provided", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: true, multicaCommentId: "comment-2" });
    await buildApp(
      fakeClient(
        { ok: true, issues: [] },
        {
          writeComment,
          async getIssue() {
            return { ok: true, issue };
          },
        },
      ),
    );

    await app.inject({
      method: "POST",
      url: "/api/decisions/PAN-1/iterate",
      payload: { prompt: "Try a second pass.", agentId: "agent-123", agentName: "Consus Dev" },
    });

    expect(writeComment.mock.calls[0][0].body).toContain("[@Consus Dev](mention://agent/agent-123)");
    const log = await app.inject({ method: "GET", url: "/api/log" });
    expect(log.json()[0].agent).toEqual({ id: "agent-123", name: "Consus Dev" });
  });

  it("rejects empty or missing prompts without posting or logging", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: true, multicaCommentId: "comment-unused" });
    await buildApp(fakeClient({ ok: true, issues: [] }, { writeComment }));

    const empty = await app.inject({
      method: "POST",
      url: "/api/decisions/PAN-1/iterate",
      payload: { prompt: "   " },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/api/decisions/PAN-1/iterate",
      payload: {},
    });

    expect(empty.statusCode).toBe(400);
    expect(missing.statusCode).toBe(400);
    expect(writeComment).not.toHaveBeenCalled();
    expect(cachedComments()).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: "/api/log" })).json()).toEqual([]);
  });

  it("returns a clear failure and writes no log when writeCommentAndCache fails", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: false, error: "Multica returned HTTP 500" });
    await buildApp(
      fakeClient(
        { ok: true, issues: [] },
        {
          writeComment,
          async getIssue() {
            return { ok: true, issue };
          },
        },
      ),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/PAN-1/iterate",
      payload: { prompt: "Try again." },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("comment write failed");
    expect(cachedComments()).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: "/api/log" })).json()).toEqual([]);
  });

  it("includes provided scope section and diagram context lines", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: true, multicaCommentId: "comment-3" });
    await buildApp(
      fakeClient(
        { ok: true, issues: [] },
        {
          writeComment,
          async getIssue() {
            return { ok: true, issue };
          },
        },
      ),
    );

    await app.inject({
      method: "POST",
      url: "/api/decisions/PAN-1/iterate",
      payload: {
        prompt: "Narrow this down.",
        scope: { section: "Risk", diagram: "flow-2" },
      },
    });

    const commentBody = writeComment.mock.calls[0][0].body;
    expect(commentBody).toContain("Scope section: Risk");
    expect(commentBody).toContain("Scope diagram: flow-2");
  });

  it("sets the issue in progress when requested and logs previous and resulting status", async () => {
    const updateIssueStatus = vi.fn().mockResolvedValue({ ok: true, status: "in_progress" });
    await buildApp(
      fakeClient(
        { ok: true, issues: [] },
        {
          async writeComment() {
            return { ok: true, multicaCommentId: "comment-4" };
          },
          async getIssue() {
            return { ok: true, issue };
          },
          updateIssueStatus,
        },
      ),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/PAN-1/iterate",
      payload: { prompt: "Move this forward.", setInProgress: true },
    });

    expect(res.statusCode).toBe(200);
    expect(updateIssueStatus).toHaveBeenCalledWith("issue-iterate", "in_progress");
    const log = await app.inject({ method: "GET", url: "/api/log" });
    expect(log.json()[0]).toMatchObject({ previous_status: "todo", status_set: "in_progress" });
  });

  it("returns log entries most recent first and caps the limit at 1000", async () => {
    await buildApp(fakeClient({ ok: true, issues: [] }));

    const entries = Array.from({ length: 1005 }, (_, i) =>
      JSON.stringify({
        log_id: `log-${i}`,
        timestamp: `2026-08-08T00:00:${String(i % 60).padStart(2, "0")}Z`,
        actor: "test",
        issue: { id: "issue", identifier: "PAN-1", title: "Title" },
        verdict: "iterate",
        prompt: `prompt-${i}`,
        scope: null,
        agent: null,
        comment_id: `comment-${i}`,
        status_set: null,
        previous_status: null,
      }),
    ).join("\n");
    rmSync(logPath, { force: true });
    writeFileSync(logPath, `${entries}\n`);

    const defaultRes = await app.inject({ method: "GET", url: "/api/log" });
    expect(defaultRes.json()).toHaveLength(100);
    expect(defaultRes.json()[0].log_id).toBe("log-1004");

    const cappedRes = await app.inject({ method: "GET", url: "/api/log?limit=5000" });
    expect(cappedRes.json()).toHaveLength(1000);
    expect(cappedRes.json()[0].log_id).toBe("log-1004");

    const limitedRes = await app.inject({ method: "GET", url: "/api/log?limit=2" });
    expect(limitedRes.json().map((entry: { log_id: string }) => entry.log_id)).toEqual(["log-1004", "log-1003"]);
    expect(readFileSync(logPath, "utf-8").split("\n").filter(Boolean)).toHaveLength(1005);
  });
});


describe("POST /api/decisions/:key/approve", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  const issue = makeIssue({
    id: "issue-approve",
    identifier: "PAN-2",
    title: "Approve the new flow",
    status: "blocked",
  });

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(async () => {
    if (app) await app.close();
    db.close();
  });

  async function buildApp(client: MulticaClient) {
    app = Fastify();
    registerDecisionRoutes(app, { db, client });
    await app.ready();
  }

  function getItem(id: string) {
    return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as { status: string; decided_at: string | null } | undefined;
  }

  it("writes a comment, unblocks the issue, and marks it decided in SQLite", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: true, multicaCommentId: "comment-1" });
    const unblockIssue = vi.fn().mockResolvedValue({ ok: true, status: "todo" });
    
    await buildApp(
      fakeClient(
        { ok: true, issues: [] },
        {
          writeComment,
          unblockIssue,
          async getIssue() {
            return { ok: true, issue };
          },
        },
      )
    );

    // Insert the item first
    insertItem(db, "multica:issue-approve", PAYLOAD);

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/multica:issue-approve/approve",
      payload: { actor: "test-user", details: "Looks good" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, comment_id: "comment-1" });

    // Verify Multica calls
    expect(writeComment).toHaveBeenCalledWith({
      itemId: "issue-approve",
      author: "test-user",
      body: "Decision approved: Looks good",
    });
    expect(unblockIssue).toHaveBeenCalledWith("issue-approve");

    // Verify SQLite
    const localItem = getItem("multica:issue-approve");
    expect(localItem?.status).toBe("approved");
    expect(localItem?.decided_at).not.toBeNull();
  });

  it("returns 502 and does not update SQLite if Multica comment write fails", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: false, error: "HTTP 500" });
    const unblockIssue = vi.fn().mockResolvedValue({ ok: true, status: "todo" });

    await buildApp(
      fakeClient(
        { ok: true, issues: [] },
        { writeComment, unblockIssue, async getIssue() { return { ok: true, issue }; } }
      )
    );

    insertItem(db, "multica:issue-approve", PAYLOAD);

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/multica:issue-approve/approve",
      payload: { actor: "test-user" },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("comment write failed");
    expect(unblockIssue).not.toHaveBeenCalled();

    // SQLite should be untouched
    const localItem = getItem("multica:issue-approve");
    expect(localItem?.status).toBe("open");
    expect(localItem?.decided_at).toBeNull();
  });

  it("returns 502 and does not update SQLite if Multica unblock fails", async () => {
    const writeComment = vi.fn().mockResolvedValue({ ok: true, multicaCommentId: "c-1" });
    const unblockIssue = vi.fn().mockResolvedValue({ ok: false, error: "HTTP 403" });

    await buildApp(
      fakeClient(
        { ok: true, issues: [] },
        { writeComment, unblockIssue, async getIssue() { return { ok: true, issue }; } }
      )
    );

    insertItem(db, "multica:issue-approve", PAYLOAD);

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/multica:issue-approve/approve",
      payload: { actor: "test-user" },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("unblock failed");

    // SQLite should be untouched
    const localItem = getItem("multica:issue-approve");
    expect(localItem?.status).toBe("open");
    expect(localItem?.decided_at).toBeNull();
  });
});

describe("GET /api/decisions — live Multica sync", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  async function buildApp(client: MulticaClient) {
    app = Fastify();
    registerDecisionRoutes(app, { db, client });
    await app.ready();
    return app;
  }

  it("fetches and classifies the live Multica feed, returning only open (undecided) issues", async () => {
    const client = fakeClient({
      ok: true,
      issues: [makeIssue({ id: "mul-open", title: "Choose the layout" })],
    });
    await buildApp(client);

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "multica:mul-open",
      type: "multica_issue",
      decision_type: "choose",
    });
  });

  it("returns the full source body from live Multica issues without truncating discussion context", async () => {
    const marker = "Architect loads full repo graph Edit any answer";
    const sourceBody = `${"long ideation context ".repeat(350)}${marker}`;
    const client = fakeClient({
      ok: true,
      issues: [makeIssue({ id: "mul-source", title: "PAN-6965 ideation", description: sourceBody })],
    });
    await buildApp(client);

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();

    expect(body[0].source_body).toBe(sourceBody);
    expect(body[0].source_body).toContain(marker);
  });

  it("excludes an already-decided Multica issue from the default (open-only) queue", async () => {
    // First sync ingests + decides the issue locally.
    await buildApp(fakeClient({ ok: true, issues: [makeIssue({ id: "mul-decided", title: "Pick one option" })] }));
    await app.inject({ method: "GET", url: "/api/decisions" });
    decideItem(db, { itemId: "multica:mul-decided", actor: "mathew", newStatus: "done" });

    const openRes = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(openRes.json().map((i: { id: string }) => i.id)).not.toContain("multica:mul-decided");
  });

  it("?all=1 includes decided Multica issues alongside open ones", async () => {
    await buildApp(fakeClient({ ok: true, issues: [makeIssue({ id: "mul-all", title: "Survey the team" })] }));
    await app.inject({ method: "GET", url: "/api/decisions" });
    decideItem(db, { itemId: "multica:mul-all", actor: "mathew", newStatus: "done" });

    const res = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    expect(res.json().map((i: { id: string }) => i.id)).toContain("multica:mul-all");
  });

  it("count parity: ~79 open Multica issues yields ~79 returned decisions", async () => {
    const issues = Array.from({ length: 79 }, (_, i) => makeIssue({ id: `mul-bulk-${i}`, title: `Task ${i}` }));
    await buildApp(fakeClient({ ok: true, issues }));

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(res.json()).toHaveLength(79);
  });

  it("returns 503 with a descriptive error when the Multica fetch fails", async () => {
    await buildApp(fakeClient({ ok: false, error: "Multica returned HTTP 500" }));

    const res = await app.inject({ method: "GET", url: "/api/decisions" });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("500");
  });
});
