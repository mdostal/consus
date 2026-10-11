import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerDecisionRoutes } from "./decisions.js";
import { getSyncStatus } from "../pantheon/sync-status.js";
import { nativeContextCount } from "../decision-contract/supporting-material.js";
import { requestNeedsContext } from "../pantheon/needs-context.js";

type CapturedCall = { url: string; init: RequestInit };

function makeFakeFetch(calls: CapturedCall[], status = 202): typeof globalThis.fetch {
  return (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify({ ok: status < 400 }), { status }));
  };
}

const drain = () => new Promise((resolve) => setImmediate(resolve));

const BARE = {
  version: "dostal:decision-request/v1",
  title: "q",
  context: "",
  options: [
    { id: "A", title: "Yes", tradeoffs: "" },
    { id: "B", title: "No", tradeoffs: "" },
  ],
  recommended: "A",
};

const WITH_RESEARCH = {
  ...BARE,
  research: [{ title: "Nav audit", body: "41 items", sources: ["apps/dashboard/src/app/super-admin/nav.ts"] }],
};

describe("PANT-938: decision:needs-context on POST /api/decisions", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let calls: CapturedCall[];

  async function build(opts: { pantheonApiUrl?: string; status?: number } = { pantheonApiUrl: "http://core-api:3012" }) {
    if (app) await app.close();
    calls = [];
    app = Fastify();
    registerDecisionRoutes(app, { db, pantheonApiUrl: opts.pantheonApiUrl, fetch: makeFakeFetch(calls, opts.status) });
    await app.ready();
  }

  function create(id: string, payload: unknown, extra: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: "/api/decisions",
      payload: { id, title: `Decision ${id}`, source_repo: "flayr", decision_payload: payload, ...extra },
    });
  }

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    await build();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.unstubAllEnvs();
  });

  it("sends exactly one event for an item with no supporting material", async () => {
    db.prepare("INSERT INTO surveys (id, title, created_at) VALUES ('s-1', 'Nav survey', ?)").run(new Date().toISOString());
    const res = await create("d-bare", BARE, { survey_id: "s-1" });
    await drain();

    expect(res.statusCode).toBe(201);
    expect(res.json().needs_context_requested_at).toEqual(expect.any(String));
    expect(res.json().supporting_material_count).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://core-api:3012/api/events/decisions/needs-context");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      decision_id: "d-bare",
      survey_id: "s-1",
      title: "Decision d-bare",
      source_repo: "flayr",
      missing: ["research", "attachments", "doc"],
    });
    expect(getSyncStatus(db).find((r) => r.direction === "needs_context_push")?.last_success_at).toEqual(
      expect.any(String),
    );
  });

  it("sends nothing for an item with sourced research", async () => {
    const res = await create("d-research", WITH_RESEARCH);
    await drain();
    expect(res.statusCode).toBe(201);
    expect(res.json().needs_context_requested_at).toBeNull();
    expect(res.json().supporting_material_count).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("sends nothing for an item with a doc pointer", async () => {
    await create("d-doc", { ...BARE, doc: { repo: "flayr", path: "docs/nav.md" } });
    await drain();
    expect(calls).toHaveLength(0);
  });

  it("still sends when research sections cite no sources", async () => {
    await create("d-unsourced", { ...BARE, research: [{ title: "Thoughts", body: "no sources", sources: [] }] });
    await drain();
    expect(calls).toHaveLength(1);
  });

  it("a repeated create (409) or a second request for the same item doesn't resend", async () => {
    await create("d-once", BARE);
    const again = await create("d-once", BARE);
    await drain();
    expect(again.statusCode).toBe(409);

    const first = db.prepare("SELECT needs_context_requested_at AS at FROM items WHERE id = 'd-once'").get() as {
      at: string;
    };
    // The update path (e.g. a later context edit) goes through the same once-only claim.
    expect(requestNeedsContext(db, "d-once", { pantheonApiUrl: "http://core-api:3012", fetch: makeFakeFetch(calls) })).toBeNull();
    await drain();

    expect(calls).toHaveLength(1);
    const after = db.prepare("SELECT needs_context_requested_at AS at FROM items WHERE id = 'd-once'").get() as {
      at: string;
    };
    expect(after.at).toBe(first.at);
  });

  it("records a Pantheon 500 in sync status, and the item still exists", async () => {
    await build({ pantheonApiUrl: "http://core-api:3012", status: 500 });
    const res = await create("d-500", BARE);
    await drain();

    expect(res.statusCode).toBe(201);
    expect(calls).toHaveLength(1);
    expect(db.prepare("SELECT id FROM items WHERE id = 'd-500'").get()).toEqual({ id: "d-500" });
    const row = getSyncStatus(db).find((r) => r.direction === "needs_context_push");
    expect(row?.last_failure_at).toEqual(expect.any(String));
    expect(row?.last_error).toBe("Pantheon needs-context event failed: 500");

    // Still listed in the open queue: never hidden for missing context.
    const list = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(list.json().map((i: { id: string }) => i.id)).toContain("d-500");
  });

  it("records a network error in sync status without failing the create", async () => {
    calls = [];
    await app.close();
    app = Fastify();
    registerDecisionRoutes(app, {
      db,
      pantheonApiUrl: "http://core-api:3012",
      fetch: () => Promise.reject(new Error("network down")),
    });
    await app.ready();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await create("d-net", BARE);
    await drain();

    expect(res.statusCode).toBe(201);
    expect(getSyncStatus(db).find((r) => r.direction === "needs_context_push")?.last_error).toBe("network down");
    errSpy.mockRestore();
  });

  it("sends nothing in standalone mode (no pantheonApiUrl, PANTHEON_API_URL unset)", async () => {
    vi.stubEnv("PANTHEON_API_URL", "");
    await build({});
    const res = await create("d-standalone", BARE);
    await drain();

    expect(res.statusCode).toBe(201);
    expect(res.json().needs_context_requested_at).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("GET /api/decisions reports needs_context_requested_at and counts native context", async () => {
    await create("d-bare", BARE);
    await create("d-research", WITH_RESEARCH);
    const rows = (await app.inject({ method: "GET", url: "/api/decisions" })).json() as Array<{
      id: string;
      supporting_material_count: number;
      needs_context_requested_at: string | null;
    }>;
    const bare = rows.find((r) => r.id === "d-bare")!;
    const research = rows.find((r) => r.id === "d-research")!;
    expect(bare.supporting_material_count).toBe(0);
    expect(bare.needs_context_requested_at).toEqual(expect.any(String));
    expect(research.supporting_material_count).toBe(1);
    expect(research.needs_context_requested_at).toBeNull();
  });
});

describe("nativeContextCount", () => {
  it("counts sourced research sections and a doc pointer", () => {
    expect(nativeContextCount(null)).toBe(0);
    expect(nativeContextCount(BARE)).toBe(0);
    expect(nativeContextCount(WITH_RESEARCH)).toBe(1);
    expect(
      nativeContextCount({
        ...WITH_RESEARCH,
        research: [...WITH_RESEARCH.research, { title: "t", body: "b", sources: ["  "] }],
        doc: { repo: "consus", path: "docs/x.md" },
      }),
    ).toBe(2);
    expect(nativeContextCount({ doc: { repo: "", path: "x" } })).toBe(0);
  });
});
