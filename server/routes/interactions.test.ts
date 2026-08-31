import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerInteractionRoutes } from "./interactions.js";

function insertDecision(db: Database.Database, id: string, title: string, sourceBody: string | null = null) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, source_body, created_at, updated_at) VALUES (?, 'decision', ?, 'open', ?, ?, ?)",
  ).run(id, title, sourceBody, now, now);
}

type CapturedCall = { url: string; init: RequestInit };

function makeFakeFetch(calls: CapturedCall[], rejectWith?: Error): typeof globalThis.fetch {
  return (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (rejectWith) return Promise.reject(rejectWith);
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 202 }));
  };
}

describe("POST /api/decisions/:id/verdict", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let bridgeCalls: CapturedCall[];

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    bridgeCalls = [];
    app = Fastify();
    registerInteractionRoutes(app, {
      db,
      pantheonApiUrl: "http://core-api:3012",
      fetch: makeFakeFetch(bridgeCalls),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("404s when the decision does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/missing/verdict",
      payload: { verdict: { kind: "accepted" } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s when verdict is missing", async () => {
    insertDecision(db, "dec-1", "Title");
    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/dec-1/verdict",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("records an accepted verdict and marks status done", async () => {
    insertDecision(db, "dec-1", "Title");
    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/dec-1/verdict",
      payload: { verdict: { kind: "accepted" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: "done" });
    const row = db.prepare("SELECT status, decided_at FROM items WHERE id = 'dec-1'").get() as {
      status: string;
      decided_at: string;
    };
    expect(row.status).toBe("done");
    expect(row.decided_at).toBeTruthy();
  });

  it("records a rejected_iteration_requested verdict and leaves status in_progress with null decided_at", async () => {
    insertDecision(db, "dec-1", "Title");
    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/dec-1/verdict",
      payload: { verdict: { kind: "rejected_iteration_requested", commentary: "try again" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: "in_progress", decided_at: null });
    const row = db.prepare("SELECT decided_at FROM items WHERE id = 'dec-1'").get() as { decided_at: null };
    expect(row.decided_at).toBeNull();
  });

  it("fires the bridge for an accepted verdict with title and createdAt", async () => {
    insertDecision(db, "dec-2", "Ship the thing");
    await app.inject({
      method: "POST",
      url: "/api/decisions/dec-2/verdict",
      payload: { verdict: { kind: "accepted" } },
    });
    // bridge is fire-and-forget — drain the microtask queue
    await new Promise((r) => setTimeout(r, 0));
    expect(bridgeCalls).toHaveLength(1);
    expect(bridgeCalls[0].url).toBe("http://core-api:3012/api/events/decisions");
    const body = JSON.parse(bridgeCalls[0].init.body as string);
    expect(body.decisionId).toBe("dec-2");
    expect(body.title).toBe("Ship the thing");
    expect(body.createdAt).toBeTruthy();
    expect("summary" in body).toBe(false);
  });

  it("includes summary in the bridge call when source_body is set", async () => {
    insertDecision(db, "dec-3", "Adopt new stack", "We need to move off Rails.");
    await app.inject({
      method: "POST",
      url: "/api/decisions/dec-3/verdict",
      payload: { verdict: { kind: "option_chosen", optionId: "A" } },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(bridgeCalls).toHaveLength(1);
    const body = JSON.parse(bridgeCalls[0].init.body as string);
    expect(body.summary).toBe("We need to move off Rails.");
  });

  it("does NOT fire the bridge for a rejected_iteration_requested verdict", async () => {
    insertDecision(db, "dec-4", "On-call rotation");
    await app.inject({
      method: "POST",
      url: "/api/decisions/dec-4/verdict",
      payload: { verdict: { kind: "rejected_iteration_requested", commentary: "needs more context" } },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(bridgeCalls).toHaveLength(0);
  });

  it("verdict succeeds even when the bridge call throws", async () => {
    const failingCalls: CapturedCall[] = [];
    const failApp = Fastify();
    registerInteractionRoutes(failApp, {
      db,
      pantheonApiUrl: "http://core-api:3012",
      fetch: makeFakeFetch(failingCalls, new Error("network down")),
    });
    await failApp.ready();

    insertDecision(db, "dec-5", "Failing bridge test");
    const res = await failApp.inject({
      method: "POST",
      url: "/api/decisions/dec-5/verdict",
      payload: { verdict: { kind: "accepted" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: "done" });

    await failApp.close();
  });

  it("skips the bridge when no pantheonApiUrl is configured and PANTHEON_API_URL is unset", async () => {
    const noBridgeCalls: CapturedCall[] = [];
    const noBridgeApp = Fastify();
    registerInteractionRoutes(noBridgeApp, {
      db,
      fetch: makeFakeFetch(noBridgeCalls),
      // no pantheonApiUrl, no env var
    });
    await noBridgeApp.ready();

    const savedEnv = process.env.PANTHEON_API_URL;
    delete process.env.PANTHEON_API_URL;

    insertDecision(db, "dec-6", "No bridge configured");
    await noBridgeApp.inject({
      method: "POST",
      url: "/api/decisions/dec-6/verdict",
      payload: { verdict: { kind: "accepted" } },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(noBridgeCalls).toHaveLength(0);

    if (savedEnv !== undefined) process.env.PANTHEON_API_URL = savedEnv;
    await noBridgeApp.close();
  });
});
