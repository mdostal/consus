/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import {
  addMessage,
  anchorError,
  buildMessageEvent,
  createThread,
  deliverMessage,
  getThread,
  listThreads,
  THREAD_CONTEXT_LIMIT,
  validateItemType,
} from "./store.js";
import { HarnessThreadNotifier, WebhookThreadNotifier, selectThreadNotifier, type ThreadNotifier } from "./notifier.js";
import { NOOP_HARNESS_TRANSPORT, PantheonHarnessTransport, type HarnessTransport } from "../harness/transport.js";
import { ThreadBus } from "./bus.js";

describe("thread store", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("creates a thread on any item type with an anchor and a pending operator message", () => {
    const { threadId, messageId } = createThread(db, {
      itemType: "doc",
      itemId: "doc:consus:README.md",
      anchor: { section: "Install", line: 12 },
      author: "Mathew",
      body: "Is this step still right?",
    });
    const thread = getThread(db, threadId)!;
    expect(thread).toMatchObject({
      itemType: "doc",
      itemId: "doc:consus:README.md",
      anchor: { section: "Install", line: 12 },
      state: "awaiting_agent",
    });
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ id: messageId, role: "operator", delivery: { status: "pending" } });
  });

  it("lists threads by item and derives state from the last message", () => {
    const a = createThread(db, { itemType: "diagram", itemId: "diagram:consus", author: "M", body: "one" });
    createThread(db, { itemType: "decision", itemId: "d1", author: "M", body: "two" });
    addMessage(db, a.threadId, { role: "agent", author: "bot", body: "done", proposalId: "p-1" });

    const diagramThreads = listThreads(db, { itemType: "diagram", itemId: "diagram:consus" });
    expect(diagramThreads).toHaveLength(1);
    expect(diagramThreads[0].state).toBe("answered");
    expect(diagramThreads[0].messages[1]).toMatchObject({ role: "agent", proposalId: "p-1", proposal: null, delivery: null });
    expect(listThreads(db, {})).toHaveLength(2);
  });

  it("resolves a linked local proposal on the reply", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES ('d1','decision','t','active',?,?)").run(now, now);
    db.prepare(
      "INSERT INTO proposals (id, item_id, target_type, diff, description, requested_by, requested_at) VALUES ('p-1','d1','doc','-a\n+b','fix it','agent',?)",
    ).run(now);
    const { threadId } = createThread(db, { itemType: "decision", itemId: "d1", author: "M", body: "q" });
    addMessage(db, threadId, { role: "agent", author: "bot", body: "opened a change", proposalId: "p-1" });
    expect(getThread(db, threadId)!.messages[1].proposal).toEqual({
      id: "p-1",
      status: "pending",
      description: "fix it",
      targetType: "doc",
    });
  });

  it("builds the outbound event with item, anchor, message, recent context and replyUrl", () => {
    const { threadId } = createThread(db, { itemType: "doc", itemId: "x", anchor: { line: 3 }, author: "M", body: "m0" });
    for (let i = 1; i <= THREAD_CONTEXT_LIMIT + 2; i++) {
      addMessage(db, threadId, { role: i % 2 ? "agent" : "operator", author: i % 2 ? "bot" : "M", body: `m${i}` });
    }
    const last = addMessage(db, threadId, { role: "operator", author: "M", body: "latest" });
    const event = buildMessageEvent(getThread(db, threadId)!, last, "http://consus.local:8722/")!;
    expect(event).toMatchObject({
      type: "consus.thread.message",
      version: 1,
      threadId,
      item: { type: "doc", id: "x" },
      anchor: { line: 3 },
      message: { id: last, role: "operator", author: "M", body: "latest" },
      replyUrl: `http://consus.local:8722/api/threads/${threadId}/replies`,
    });
    expect(event.context).toHaveLength(THREAD_CONTEXT_LIMIT);
    expect(event.context[event.context.length - 1].body).toBe(`m${THREAD_CONTEXT_LIMIT + 2}`);
  });

  it("records delivery success and failure on the message", async () => {
    const { threadId, messageId } = createThread(db, { itemType: "doc", itemId: "x", author: "M", body: "hi" });
    const failing: ThreadNotifier = { target: "test", notify: async () => ({ ok: false, error: "down" }) };
    await deliverMessage(db, failing, threadId, messageId, "http://h");
    let thread = getThread(db, threadId)!;
    expect(thread.state).toBe("delivery_failed");
    expect(thread.messages[0].delivery).toMatchObject({ status: "failed", error: "down", target: "test" });

    const ok: ThreadNotifier = { target: "test", notify: async () => ({ ok: true }) };
    await deliverMessage(db, ok, threadId, messageId, "http://h");
    thread = getThread(db, threadId)!;
    expect(thread.state).toBe("awaiting_agent");
    expect(thread.messages[0].delivery).toMatchObject({ status: "delivered", error: null });
  });

  it("validates item types and anchors", () => {
    expect(validateItemType("doc")).toBe(true);
    expect(validateItemType("doc-section")).toBe(true);
    expect(validateItemType("Doc")).toBe(false);
    expect(validateItemType("")).toBe(false);
    expect(anchorError(undefined)).toBeNull();
    expect(anchorError({ section: "A" })).toBeNull();
    expect(anchorError([1])).toMatch(/object/);
    expect(anchorError("line 3")).toMatch(/object/);
    expect(anchorError({ quote: "x".repeat(3000) })).toMatch(/at most/);
  });
});

describe("thread notifiers", () => {
  const event = {
    type: "consus.thread.message" as const,
    version: 1 as const,
    threadId: "t1",
    item: { type: "doc", id: "x" },
    anchor: null,
    message: { id: 1, role: "operator" as const, author: "M", body: "hi", createdAt: "now" },
    context: [],
    replyUrl: "http://h/api/threads/t1/replies",
  };

  it("webhook POSTs the bare event and maps non-2xx/network errors", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    let status = 202;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(status === 202 ? "" : "nope", { status });
    }) as unknown as typeof fetch;
    const n = new WebhookThreadNotifier("http://hook/x", { fetch: fetchImpl });
    expect(await n.notify(event)).toEqual({ ok: true });
    expect(calls[0]).toEqual({ url: "http://hook/x", body: event });
    status = 500;
    expect(await n.notify(event)).toEqual({ ok: false, error: "HTTP 500: nope" });

    const broken = new WebhookThreadNotifier("http://hook/x", {
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(await broken.notify(event)).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("harness notifier calls threadMessage and explains NO_ADAPTER / UNKNOWN_METHOD", async () => {
    const seen: Array<[string, unknown]> = [];
    const transport: HarnessTransport = {
      async invoke(method, params) {
        seen.push([method, params]);
        return { ok: true, result: null } as never;
      },
    };
    expect(await new HarnessThreadNotifier(transport, "stdio").notify(event)).toEqual({ ok: true });
    expect(seen).toEqual([["threadMessage", event]]);

    const noop = await new HarnessThreadNotifier(NOOP_HARNESS_TRANSPORT, "noop").notify(event);
    expect(noop).toMatchObject({ ok: false, error: expect.stringMatching(/no agent configured/) });
    const pantheon = await new HarnessThreadNotifier(new PantheonHarnessTransport("http://p"), "pantheon").notify(event);
    expect(pantheon).toMatchObject({ ok: false, error: expect.stringMatching(/CONSUS_THREAD_WEBHOOK_URL/) });
  });

  it("selectThreadNotifier prefers CONSUS_THREAD_WEBHOOK_URL and rejects a bad URL", () => {
    expect(selectThreadNotifier({ CONSUS_THREAD_WEBHOOK_URL: "http://hook/x" }, NOOP_HARNESS_TRANSPORT, "noop").target).toBe("webhook");
    expect(selectThreadNotifier({}, NOOP_HARNESS_TRANSPORT, "file").target).toBe("harness:file");
    expect(() => selectThreadNotifier({ CONSUS_THREAD_WEBHOOK_URL: "not a url" }, NOOP_HARNESS_TRANSPORT, "noop")).toThrow(
      /not a valid URL/,
    );
  });
});

describe("ThreadBus", () => {
  it("fans out to subscribers and stops after unsubscribe", () => {
    const bus = new ThreadBus();
    const got: string[] = [];
    const off = bus.subscribe((t) => got.push(t.id));
    bus.subscribe(() => {
      throw new Error("broken stream");
    });
    bus.publish({ id: "a" } as never);
    off();
    bus.publish({ id: "b" } as never);
    expect(got).toEqual(["a"]);
    expect(bus.size).toBe(1);
  });
});
