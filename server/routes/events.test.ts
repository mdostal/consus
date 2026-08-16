import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { createEvent, getEvent, type EventRow } from "../events/store.js";
import { docItemIdFor } from "./docs.js";
import { registerEventRoutes } from "./events.js";
import type { HarnessTransport, HarnessResult } from "../harness/transport.js";

function fakeTransport(): HarnessTransport & { calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    async invoke<T>(method: string, params?: unknown) {
      calls.push({ method, params });
      return { ok: true, result: {} } as HarnessResult<T>;
    },
  };
}

function baseEventInput(overrides: Partial<Parameters<typeof createEvent>[1]> = {}) {
  return {
    project: "proj-a",
    triggerKind: "doc_changed" as const,
    sourceRepo: "org/repo",
    sourcePath: "docs/foo.md",
    contentHash: "hash-1",
    composedPrompt: "prompt text",
    ...overrides,
  };
}

describe("GET /api/events", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerEventRoutes(app, { db, repos: {}, transport: fakeTransport() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("returns every non-archived event across projects/statuses with no query params", async () => {
    createEvent(db, baseEventInput({ project: "proj-a" }));
    createEvent(db, baseEventInput({ project: "proj-b" }));
    const archived = createEvent(db, baseEventInput({ project: "proj-a" }));
    db.prepare("UPDATE events SET status = 'done', archived_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      archived.id,
    );

    const res = await app.inject({ method: "GET", url: "/api/events" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as EventRow[];
    expect(body).toHaveLength(2);
    expect(body.every((e) => e.archived_at === null)).toBe(true);
  });

  it("filters by project and status together", async () => {
    createEvent(db, baseEventInput({ project: "foo" }));
    const target = createEvent(db, baseEventInput({ project: "foo" }));
    db.prepare("UPDATE events SET status = 'in_progress' WHERE id = ?").run(target.id);
    createEvent(db, baseEventInput({ project: "bar" }));

    const res = await app.inject({ method: "GET", url: "/api/events?project=foo&status=in_progress" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as EventRow[];
    expect(body.map((e) => e.id)).toEqual([target.id]);
  });

  it("400s on an invalid status value rather than returning an empty or unfiltered 200", async () => {
    createEvent(db, baseEventInput());

    const res = await app.inject({ method: "GET", url: "/api/events?status=bogus" });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeTruthy();
  });

  it("orders by sort/order params, and 400s on an invalid sort or order value", async () => {
    const e1 = createEvent(db, baseEventInput());
    await new Promise((r) => setTimeout(r, 2));
    const e2 = createEvent(db, baseEventInput());

    const asc = await app.inject({ method: "GET", url: "/api/events?sort=detected_at&order=asc" });
    expect(asc.statusCode).toBe(200);
    expect(asc.json().map((e: EventRow) => e.id)).toEqual([e1.id, e2.id]);

    const desc = await app.inject({ method: "GET", url: "/api/events?sort=detected_at&order=desc" });
    expect(desc.statusCode).toBe(200);
    expect(desc.json().map((e: EventRow) => e.id)).toEqual([e2.id, e1.id]);

    const badSort = await app.inject({ method: "GET", url: "/api/events?sort=bogus" });
    expect(badSort.statusCode).toBe(400);

    const badOrder = await app.inject({ method: "GET", url: "/api/events?order=bogus" });
    expect(badOrder.statusCode).toBe(400);
  });
});

describe("GET /api/events/history", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerEventRoutes(app, { db, repos: {}, transport: fakeTransport() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("returns only archived events, honoring the same project/status/sort/order params", async () => {
    const active = createEvent(db, baseEventInput({ project: "proj-a" }));
    const archived1 = createEvent(db, baseEventInput({ project: "proj-a" }));
    const archived2 = createEvent(db, baseEventInput({ project: "proj-b" }));
    db.prepare("UPDATE events SET status = 'done', archived_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      archived1.id,
    );
    db.prepare("UPDATE events SET status = 'dismissed', archived_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      archived2.id,
    );

    const res = await app.inject({ method: "GET", url: "/api/events/history" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((e: EventRow) => e.id);
    expect(ids.sort()).toEqual([archived1.id, archived2.id].sort());
    expect(ids).not.toContain(active.id);

    const scoped = await app.inject({ method: "GET", url: "/api/events/history?project=proj-a" });
    expect(scoped.json().map((e: EventRow) => e.id)).toEqual([archived1.id]);

    const badStatus = await app.inject({ method: "GET", url: "/api/events/history?status=bogus" });
    expect(badStatus.statusCode).toBe(400);
  });
});

describe("PATCH /api/events/:id/status", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerEventRoutes(app, { db, repos: {}, transport: fakeTransport() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("updates status and the event moves from GET /api/events into (or out of) history accordingly", async () => {
    const created = createEvent(db, baseEventInput());

    const res = await app.inject({
      method: "PATCH",
      url: `/api/events/${created.id}/status`,
      payload: { status: "in_progress" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("in_progress");

    const history = await app.inject({ method: "GET", url: "/api/events/history" });
    expect(history.json().map((e: EventRow) => e.id)).not.toContain(created.id);

    const active = await app.inject({ method: "GET", url: "/api/events" });
    expect(active.json().map((e: EventRow) => e.id)).toContain(created.id);
  });

  it("400s on an invalid status value, leaving the event's status unchanged", async () => {
    const created = createEvent(db, baseEventInput());

    const res = await app.inject({
      method: "PATCH",
      url: `/api/events/${created.id}/status`,
      payload: { status: "bogus" },
    });

    expect(res.statusCode).toBe(400);
    const row = getEvent(db, created.id);
    expect(row!.status).toBe("new");
  });

  it("404s for a non-existent event id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/events/does-not-exist/status",
      payload: { status: "done" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/events/:id/propose", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let transport: ReturnType<typeof fakeTransport>;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    transport = fakeTransport();
    app = Fastify();
    registerEventRoutes(app, { db, repos: { "org/repo": "/tmp/whatever" }, transport });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("graduates a doc_changed event with a diff into a new proposal, upserting the target item and backfilling proposal_id", async () => {
    const event = createEvent(
      db,
      baseEventInput({ triggerKind: "doc_changed", diff: "+ added line\n- removed line" }),
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/propose`,
      payload: { description: "graduate this diff", requestedBy: "mathew" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.proposal).toBeTruthy();
    expect(body.proposal.diff).toBe(event.diff);
    expect(body.proposal.description).toBe("graduate this diff");

    const proposalRow = db.prepare("SELECT * FROM proposals WHERE id = ?").get(body.proposal.id) as {
      diff: string;
      description: string;
    };
    expect(proposalRow.diff).toBe(event.diff);
    expect(proposalRow.description).toBe("graduate this diff");

    const itemId = docItemIdFor(event.source_repo, event.source_path);
    const itemRow = db.prepare("SELECT id, type, source_repo FROM items WHERE id = ?").get(itemId) as
      | { id: string; type: string; source_repo: string }
      | undefined;
    expect(itemRow).toBeDefined();
    expect(itemRow!.type).toBe("doc");
    expect(itemRow!.source_repo).toBe(event.source_repo);

    expect(body.event.proposal_id).toBe(body.proposal.id);
    const updatedEvent = getEvent(db, event.id);
    expect(updatedEvent!.proposal_id).toBe(body.proposal.id);
  });

  it("400s a decision_needed event (diff is null), creating no proposals row and no items-upsert side effect", async () => {
    const event = createEvent(
      db,
      baseEventInput({ triggerKind: "decision_needed", diff: null }),
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/propose`,
      payload: { description: "d", requestedBy: "mathew" },
    });

    expect(res.statusCode).toBe(400);

    const proposalCount = db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number };
    expect(proposalCount.n).toBe(0);

    const itemId = docItemIdFor(event.source_repo, event.source_path);
    const itemRow = db.prepare("SELECT id FROM items WHERE id = ?").get(itemId);
    expect(itemRow).toBeUndefined();

    const unchangedEvent = getEvent(db, event.id);
    expect(unchangedEvent!.proposal_id).toBeNull();
  });

  it("404s for a non-existent event id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events/does-not-exist/propose",
      payload: { description: "d", requestedBy: "mathew" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("allows re-proposing an already-proposed event, creating a second independent proposal and updating proposal_id to the newest", async () => {
    const event = createEvent(db, baseEventInput({ triggerKind: "doc_changed", diff: "+ line one" }));

    const first = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/propose`,
      payload: { description: "first pass", requestedBy: "mathew" },
    });
    expect(first.statusCode).toBe(200);
    const firstProposalId = first.json().proposal.id;

    const second = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/propose`,
      payload: { description: "second pass", requestedBy: "mathew" },
    });
    expect(second.statusCode).toBe(200);
    const secondProposalId = second.json().proposal.id;

    expect(secondProposalId).not.toBe(firstProposalId);

    const proposalCount = db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number };
    expect(proposalCount.n).toBe(2);

    const updatedEvent = getEvent(db, event.id);
    expect(updatedEvent!.proposal_id).toBe(secondProposalId);
  });

  it("never sets the event's status as a side effect of proposing", async () => {
    const event = createEvent(db, baseEventInput({ triggerKind: "doc_changed", diff: "+ line" }));
    expect(event.status).toBe("new");

    await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/propose`,
      payload: { description: "d", requestedBy: "mathew" },
    });

    const updatedEvent = getEvent(db, event.id);
    expect(updatedEvent!.status).toBe("new");
  });
});
