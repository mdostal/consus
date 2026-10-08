import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerDecisionRoutes } from "./decisions.js";
import { registerInteractionRoutes } from "./interactions.js";
import { getAuditLog } from "../kb/store.js";

const BARE = {
  version: "dostal:decision-request/v1",
  title: "q",
  context: "There are 37 nav items.",
  options: [
    { id: "A", title: "Yes", tradeoffs: "" },
    { id: "B", title: "No", tradeoffs: "" },
  ],
  recommended: "A",
};

const RESEARCH = [{ title: "Nav audit", body: "41 nav items", sources: ["apps/dashboard/src/app/super-admin/nav.ts"] }];

describe("PANT-937: editable decision context and generic close", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    // Standalone mode: no needs-context event leaves the test process.
    vi.stubEnv("PANTHEON_API_URL", "");
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerDecisionRoutes(app, { db });
    registerInteractionRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.unstubAllEnvs();
  });

  function create(id: string, extra: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: "/api/decisions",
      payload: { id, title: `Decision ${id}`, decision_payload: BARE, ...extra },
    });
  }

  function patch(id: string, payload: Record<string, unknown>) {
    return app.inject({ method: "PATCH", url: `/api/decisions/${id}/context`, payload });
  }

  function close(id: string, payload: Record<string, unknown> = { reason: "superseded", actor: "pant-919" }) {
    return app.inject({ method: "POST", url: `/api/items/${id}/close`, payload });
  }

  async function listed(id: string) {
    const res = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    return (res.json() as Array<Record<string, unknown>>).find((r) => r.id === id);
  }

  describe("PATCH /api/decisions/:id/context", () => {
    it("replaces research, doc and context on an unanswered decision and audits before/after", async () => {
      await create("d-1");
      const res = await patch("d-1", {
        research: RESEARCH,
        doc: { repo: "flayr", path: "docs/nav.md" },
        context: "There are 41 nav items.",
        actor: "pant-919",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.decision_payload.research).toEqual(RESEARCH);
      expect(body.decision_payload.doc).toEqual({ repo: "flayr", path: "docs/nav.md" });
      expect(body.decision_payload.context).toBe("There are 41 nav items.");
      expect(body.decision_payload.options).toEqual(BARE.options);
      expect(body.supporting_material_count).toBe(2);

      const audit = getAuditLog(db, "d-1").filter((r) => r.field === "decision_context");
      expect(audit).toHaveLength(1);
      expect(audit[0].actor).toBe("pant-919");
      expect(JSON.parse(audit[0].old_value!)).toEqual({ research: null, doc: null, context: "There are 37 nav items." });
      expect(JSON.parse(audit[0].new_value!).context).toBe("There are 41 nav items.");
    });

    it("leaves fields the body omits untouched, and `doc: null` removes the pointer", async () => {
      await create("d-1", { decision_payload: { ...BARE, research: RESEARCH, doc: { repo: "flayr", path: "x.md" } } });
      const res = await patch("d-1", { doc: null, actor: "agent" });

      expect(res.statusCode).toBe(200);
      const payload = res.json().decision_payload;
      expect(payload.doc).toBeUndefined();
      expect(payload.research).toEqual(RESEARCH);
      expect(payload.context).toBe(BARE.context);
    });

    it("returns 409 once a verdict has answered the decision, and changes nothing", async () => {
      await create("d-1");
      const verdict = await app.inject({
        method: "POST",
        url: "/api/decisions/d-1/verdict",
        payload: { verdict: { kind: "option_chosen", optionId: "A" }, actor: "Mathew" },
      });
      expect(verdict.statusCode).toBe(200);

      const res = await patch("d-1", { context: "edited", actor: "agent" });
      expect(res.statusCode).toBe(409);
      expect((await listed("d-1"))!.decision_payload).toEqual(BARE);
    });

    it("rejects an invalid research shape with 422", async () => {
      await create("d-1");
      for (const research of [
        "not an array",
        [{ body: "no title" }],
        [{ title: "t", body: "b", sources: "one" }],
        [{ title: "t", body: "b", sources: [1] }],
      ]) {
        const res = await patch("d-1", { research, actor: "agent" });
        expect(res.statusCode).toBe(422);
      }
      expect((await patch("d-1", { doc: { repo: "flayr" }, actor: "agent" })).statusCode).toBe(422);
      expect((await patch("d-1", { context: 42, actor: "agent" })).statusCode).toBe(422);
      expect(getAuditLog(db, "d-1")).toHaveLength(0);
    });

    it("400s without an actor or any editable field; 404s for an unknown decision", async () => {
      await create("d-1");
      expect((await patch("d-1", { research: RESEARCH })).statusCode).toBe(400);
      expect((await patch("d-1", { actor: "agent" })).statusCode).toBe(400);
      expect((await patch("nope", { context: "x", actor: "agent" })).statusCode).toBe(404);
    });

    it("a decision with a sourced research section and no attachments isn't flagged as missing context", async () => {
      await create("d-1");
      expect((await listed("d-1"))!.supporting_material_count).toBe(0);

      await patch("d-1", { research: RESEARCH, actor: "agent" });
      expect((await listed("d-1"))!.supporting_material_count).toBe(1);
    });
  });

  describe("POST /api/items/:id/close", () => {
    it("closes a single decision with an audit row and a comment, and a repeat call is a no-op", async () => {
      await create("d-1");
      const res = await close("d-1");

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: "d-1", kind: "item", closed_item_ids: ["d-1"] });
      const row = db.prepare("SELECT status, decided_at FROM items WHERE id = 'd-1'").get() as {
        status: string;
        decided_at: string | null;
      };
      expect(row).toEqual({ status: "closed", decided_at: null });
      const audit = getAuditLog(db, "d-1").filter((r) => r.field === "status");
      expect(audit).toMatchObject([{ actor: "pant-919", old_value: "open", new_value: "closed" }]);
      const comments = db.prepare("SELECT body FROM comments WHERE item_id = 'd-1'").all();
      expect(comments).toEqual([{ body: "Closed: superseded" }]);

      const again = await close("d-1");
      expect(again.statusCode).toBe(200);
      expect(again.json().closed_item_ids).toEqual([]);
      expect(getAuditLog(db, "d-1").filter((r) => r.field === "status")).toHaveLength(1);

      const pending = (await app.inject({ method: "GET", url: "/api/decisions" })).json() as Array<{ id: string }>;
      expect(pending.map((d) => d.id)).not.toContain("d-1");
      expect(await listed("d-1")).toBeDefined();
    });

    it("closes every open member when given a survey id, leaving decided members alone", async () => {
      db.prepare("INSERT INTO surveys (id, title, created_at) VALUES ('s-1', 'Nav survey', ?)").run(
        new Date().toISOString(),
      );
      await create("d-1", { survey_id: "s-1" });
      await create("d-2", { survey_id: "s-1" });
      await create("d-3", { survey_id: "s-1" });
      await create("other");
      await app.inject({
        method: "POST",
        url: "/api/decisions/d-3/verdict",
        payload: { verdict: { kind: "accepted" }, actor: "Mathew" },
      });

      const res = await close("s-1");
      expect(res.statusCode).toBe(200);
      expect(res.json().kind).toBe("survey");
      expect([...res.json().closed_item_ids].sort()).toEqual(["d-1", "d-2"]);

      const statuses = db.prepare("SELECT id, status FROM items ORDER BY id").all();
      expect(statuses).toEqual([
        { id: "d-1", status: "closed" },
        { id: "d-2", status: "closed" },
        { id: "d-3", status: "done" },
        { id: "other", status: "open" },
      ]);
      expect((await close("s-1")).json().closed_item_ids).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 4 });
    });

    it("blocks a verdict on a closed decision", async () => {
      await create("d-1");
      await close("d-1");
      const verdict = await app.inject({
        method: "POST",
        url: "/api/decisions/d-1/verdict",
        payload: { verdict: { kind: "accepted" }, actor: "Mathew" },
      });
      expect(verdict.statusCode).toBe(409);
    });

    it("400s without a reason or actor; 404s for an unknown id", async () => {
      await create("d-1");
      expect((await close("d-1", { actor: "agent" })).statusCode).toBe(400);
      expect((await close("d-1", { reason: "x" })).statusCode).toBe(400);
      expect((await close("nope")).statusCode).toBe(404);
    });
  });
});
