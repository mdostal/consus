/**
 * @vitest-environment node
 *
 * Agent threads end to end (PANT-962): Consus listens on a real port, the
 * outbound receiver is a real HTTP server, the agent answers through the
 * event's replyUrl, and the UI's SSE stream sees the reply live. The
 * standalone case drives the file harness through bin/handoff.mjs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigration } from "../db/migrate.js";
import { registerThreadRoutes } from "./threads.js";
import { registerProposalRoutes } from "./proposals.js";
import { WebhookThreadNotifier } from "../threads/notifier.js";
import { FileHarnessTransport, NOOP_HARNESS_TRANSPORT } from "../harness/transport.js";
import { buildServer } from "../index.js";
import type { Thread, ThreadMessageEvent } from "../threads/store.js";

const HANDOFF_CLI = join(dirname(fileURLToPath(import.meta.url)), "../../bin/handoff.mjs");
const run = promisify(execFile);

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Thread & { error?: string } };
}

/** Reads `event: thread` frames off an SSE response until `count` arrive. */
async function readSse(res: Response, count: number): Promise<Thread[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const out: Thread[] = [];
  let buf = "";
  while (out.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!frame.startsWith("event: thread")) continue;
      out.push(JSON.parse(frame.split("\n").find((l) => l.startsWith("data: "))!.slice(6)));
    }
  }
  await reader.cancel();
  return out;
}

describe("thread routes — webhook out, agent reply in, live stream", () => {
  let db: Database.Database;
  let consus: FastifyInstance;
  let consusUrl: string;
  let hook: Server;
  let received: ThreadMessageEvent[];
  let hookStatus: number;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    received = [];
    hookStatus = 202;
    hook = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        received.push(JSON.parse(raw));
        res.writeHead(hookStatus).end(hookStatus === 202 ? "" : "receiver down");
      });
    });
    await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
    const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/threads`;

    consus = Fastify();
    registerProposalRoutes(consus, { db, transport: NOOP_HARNESS_TRANSPORT });
    registerThreadRoutes(consus, { db, notifier: new WebhookThreadNotifier(hookUrl) });
    consusUrl = await consus.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await consus.close();
    hook.closeAllConnections();
    await new Promise((r) => hook.close(r));
    db.close();
  });

  it("operator post sends the generic event; the agent's reply lands in the thread with a linked proposal", async () => {
    const created = await postJson(`${consusUrl}/api/threads`, {
      itemType: "doc",
      itemId: "doc:consus:docs/index.md",
      anchor: { section: "Getting started", line: 4, lineEnd: 9 },
      body: "  Can you tighten this section?  ",
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ state: "awaiting_agent", anchor: { section: "Getting started", line: 4, lineEnd: 9 } });
    expect(created.json.messages[0]).toMatchObject({
      role: "operator",
      author: "Mathew",
      body: "Can you tighten this section?",
      delivery: { status: "delivered", target: "webhook", error: null },
    });

    expect(received).toHaveLength(1);
    const event = received[0];
    expect(event).toMatchObject({
      type: "consus.thread.message",
      version: 1,
      threadId: created.json.id,
      item: { type: "doc", id: "doc:consus:docs/index.md" },
      anchor: { section: "Getting started", line: 4, lineEnd: 9 },
      message: { role: "operator", body: "Can you tighten this section?" },
      context: [],
      replyUrl: `${consusUrl}/api/threads/${created.json.id}/replies`,
    });

    const replied = await postJson(event.replyUrl, {
      author: "pantheon:auriga",
      body: "Opened a change that cuts it to three steps.",
      proposalId: "prop-123",
      proposalUrl: "https://github.com/mdostal/consus/pull/1",
    });
    expect(replied.status).toBe(201);
    expect(replied.json.state).toBe("answered");
    expect(replied.json.messages[1]).toMatchObject({
      role: "agent",
      author: "pantheon:auriga",
      proposalId: "prop-123",
      proposalUrl: "https://github.com/mdostal/consus/pull/1",
      delivery: null,
    });

    // A follow-up carries the earlier exchange as context.
    const followUp = await postJson(`${consusUrl}/api/threads/${created.json.id}/messages`, { body: "Looks good, also fix the title" });
    expect(followUp.status).toBe(201);
    expect(followUp.json.state).toBe("awaiting_agent");
    expect(received[1].context.map((m) => m.role)).toEqual(["operator", "agent"]);
    expect(received[1].message.body).toBe("Looks good, also fix the title");

    const listed = await (await fetch(`${consusUrl}/api/threads?itemType=doc&itemId=${encodeURIComponent("doc:consus:docs/index.md")}`)).json();
    expect(listed).toHaveLength(1);
    expect(listed[0].messages).toHaveLength(3);
  });

  it("a failed delivery is recorded and retried by hand, never by a timer", async () => {
    hookStatus = 503;
    const created = await postJson(`${consusUrl}/api/threads`, { itemType: "diagram", itemId: "diagram:consus", body: "Add the cache box" });
    expect(created.status).toBe(201);
    expect(created.json.state).toBe("delivery_failed");
    expect(created.json.messages[0].delivery).toMatchObject({ status: "failed", error: "HTTP 503: receiver down" });

    hookStatus = 202;
    const retried = await postJson(`${consusUrl}/api/threads/${created.json.id}/redeliver`, {});
    expect(retried.status).toBe(200);
    expect(retried.json.state).toBe("awaiting_agent");
    expect(received).toHaveLength(2);
    expect(received[1].message.id).toBe(received[0].message.id);

    const again = await postJson(`${consusUrl}/api/threads/${created.json.id}/redeliver`, {});
    expect(again.status).toBe(409);
  });

  it("rejects bad input on both directions", async () => {
    expect((await postJson(`${consusUrl}/api/threads`, { itemId: "x", body: "b" })).status).toBe(400);
    expect((await postJson(`${consusUrl}/api/threads`, { itemType: "Doc!", itemId: "x", body: "b" })).status).toBe(400);
    expect((await postJson(`${consusUrl}/api/threads`, { itemType: "doc", body: "b" })).status).toBe(400);
    expect((await postJson(`${consusUrl}/api/threads`, { itemType: "doc", itemId: "x", body: "  " })).status).toBe(400);
    expect((await postJson(`${consusUrl}/api/threads`, { itemType: "doc", itemId: "x", body: "b", anchor: "line 3" })).status).toBe(400);
    expect(received).toHaveLength(0);

    expect((await postJson(`${consusUrl}/api/threads/nope/replies`, { author: "a", body: "b" })).status).toBe(404);
    expect((await postJson(`${consusUrl}/api/threads/nope/messages`, { body: "b" })).status).toBe(404);
    expect((await fetch(`${consusUrl}/api/threads/nope`)).status).toBe(404);

    const { json } = await postJson(`${consusUrl}/api/threads`, { itemType: "decision", itemId: "d1", body: "?" });
    const replies = `${consusUrl}/api/threads/${json.id}/replies`;
    expect((await postJson(replies, { body: "no author" })).status).toBe(400);
    expect((await postJson(replies, { author: "a" })).status).toBe(400);
    expect((await postJson(replies, { author: "a", body: "b", proposalId: "" })).status).toBe(400);
    expect((await postJson(replies, { author: "a", body: "b", proposalUrl: "not/absolute" })).status).toBe(400);
    expect((await fetch(`${consusUrl}/api/threads/${json.id}`)).status).toBe(200);
  });

  it("streams thread changes for the watched item over SSE, without a reload", async () => {
    const { json: thread } = await postJson(`${consusUrl}/api/threads`, { itemType: "decision", itemId: "d1", body: "Which option?" });
    await postJson(`${consusUrl}/api/threads`, { itemType: "decision", itemId: "other", body: "unrelated" });

    const stream = await fetch(`${consusUrl}/api/threads/stream?itemType=decision&itemId=d1`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const frames = readSse(stream, 1);

    // A change on another item must not reach this stream.
    await postJson(`${consusUrl}/api/threads/${received[1].threadId}/replies`, { author: "bot", body: "other answer" });
    await postJson(received[0].replyUrl, { author: "bot", body: "Option B." });

    const [pushed] = await frames;
    expect(pushed.id).toBe(thread.id);
    expect(pushed.state).toBe("answered");
    expect(pushed.messages[1]).toMatchObject({ role: "agent", body: "Option B." });
  });

  it("GET /api/proposals/:id returns one proposal for the 'view change' link", async () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES ('d1','decision','t','active',?,?)").run(now, now);
    db.prepare(
      "INSERT INTO proposals (id, item_id, target_type, diff, description, requested_by, requested_at) VALUES ('p-1','d1','doc','+x','why','agent',?)",
    ).run(now);
    const res = await fetch(`${consusUrl}/api/proposals/p-1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "p-1", diff: "+x", description: "why" });
    expect((await fetch(`${consusUrl}/api/proposals/missing`)).status).toBe(404);
  });
});

describe("thread routes — publicUrl and the default no-agent case", () => {
  it("uses publicUrl for replyUrl and reports no agent when nothing is configured", async () => {
    const captured: ThreadMessageEvent[] = [];
    const app = Fastify();
    const db = new Database(":memory:");
    runMigration(db);
    registerThreadRoutes(app, {
      db,
      publicUrl: "https://consus.example.com",
      notifier: { target: "test", notify: async (e) => (captured.push(e), { ok: true }) },
    });
    const res = await app.inject({ method: "POST", url: "/api/threads", payload: { itemType: "proposal", itemId: "p-9", body: "why?" } });
    expect(res.statusCode).toBe(201);
    expect(captured[0].replyUrl).toBe(`https://consus.example.com/api/threads/${res.json().id}/replies`);
    await app.close();

    const standalone = buildServer({ dbPath: ":memory:", webRoot: "/nonexistent" });
    const res2 = await standalone.inject({ method: "POST", url: "/api/threads", payload: { itemType: "doc", itemId: "x", body: "hi" } });
    expect(res2.statusCode).toBe(201);
    expect(res2.json().state).toBe("delivery_failed");
    expect(res2.json().messages[0].delivery.error).toMatch(/no agent configured/);
    await standalone.close();
  });
});

describe("standalone file harness — post, consus-handoff threads, consus-handoff reply", () => {
  let dir: string;
  let app: FastifyInstance;
  let url: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "consus-threads-"));
    app = buildServer({ dbPath: ":memory:", webRoot: "/nonexistent", transport: new FileHarnessTransport(dir) });
    url = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the event to <dir>/threads and the CLI answers it", async () => {
    const created = await postJson(`${url}/api/threads`, {
      itemType: "diagram",
      itemId: "diagram:consus",
      anchor: { nodeId: "server" },
      body: "Split the server box in two",
    });
    expect(created.status).toBe(201);
    expect(created.json.messages[0].delivery).toMatchObject({ status: "delivered", target: "harness:file" });

    const threadsDir = join(dir, "threads");
    const files = readdirSync(threadsDir);
    expect(files).toEqual([`${created.json.id}.${created.json.messages[0].id}.json`]);
    const event = JSON.parse(readFileSync(join(threadsDir, files[0]), "utf8")) as ThreadMessageEvent;
    expect(event).toMatchObject({ threadId: created.json.id, anchor: { nodeId: "server" }, replyUrl: `${url}/api/threads/${created.json.id}/replies` });

    const env = { ...process.env, CONSUS_HANDOFF_DIR: dir, CONSUS_URL: url, CONSUS_AGENT_NAME: "local-agent" };
    const listed = await run("node", [HANDOFF_CLI, "threads"], { env });
    expect(listed.stdout).toContain(created.json.id);
    expect(listed.stdout).toContain("Split the server box in two");

    const replied = await run("node", [HANDOFF_CLI, "reply", created.json.id, "--proposal", "p-42", "Done,", "see", "the", "change."], { env });
    expect(replied.stdout).toContain(`Replied to thread ${created.json.id}.`);
    expect(existsSync(join(threadsDir, files[0]))).toBe(false);

    const thread = (await (await fetch(`${url}/api/threads/${created.json.id}`)).json()) as Thread;
    expect(thread.state).toBe("answered");
    expect(thread.messages[1]).toMatchObject({ role: "agent", author: "local-agent", body: "Done, see the change.", proposalId: "p-42" });
  });
});
