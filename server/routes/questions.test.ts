/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerQuestionRoutes } from "./questions.js";
import { registerDecisionRoutes } from "./decisions.js";
import { registerInteractionRoutes } from "./interactions.js";

const TICKET = {
  ticket_id: "ticket-1",
  identifier: "PANT-1",
  questions: [
    { qid: "q1", text: "Which DB?", kind: "single-select", options: ["Postgres", "SQLite"] },
    { qid: "q2", text: "Which features?", kind: "multi", options: ["Auth", "Search"] },
    { qid: "q3", text: "Anything else?", kind: "free-text" },
    { qid: "q4", text: "Unmappable", kind: "rating" },
  ],
};

let db: Database.Database;
let app: FastifyInstance;

beforeEach(async () => {
  db = new Database(":memory:");
  runMigration(db);
  app = Fastify();
  registerQuestionRoutes(app, { db });
  registerDecisionRoutes(app, { db });
  // PANTHEON_API_URL may be set in the env, which turns the verdict bridge on;
  // a stub fetch keeps it off the network.
  registerInteractionRoutes(app, { db, fetch: async () => new Response("{}", { status: 200 }) });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

function importTicket(body: unknown) {
  return app.inject({ method: "POST", url: "/api/questions/import", payload: body as object });
}

function closeTicket(ticket: string, body: unknown) {
  return app.inject({ method: "POST", url: `/api/questions/${ticket}/close`, payload: body as object });
}

/** Every row a ticket import writes, minus generated ids/timestamps. */
function ticketRows(ticketId: string) {
  return db
    .prepare(
      `SELECT s.title AS survey_title, s.description AS survey_description,
              i.type, i.title, i.status, i.decision_payload, i.decided_at, ql.ticket_id, ql.qid
       FROM question_links ql
       JOIN items i ON i.id = ql.item_id
       JOIN surveys s ON s.id = ql.survey_id
       WHERE ql.ticket_id = ?
       ORDER BY ql.qid`,
    )
    .all(ticketId);
}

describe("POST /api/questions/import", () => {
  it("creates one survey with one decision item per mappable question (201)", async () => {
    const res = await importTicket(TICKET);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ticket_id).toBe("ticket-1");
    expect(typeof body.survey_id).toBe("string");
    expect(body.item_ids).toHaveLength(3);

    const rows = ticketRows("ticket-1") as Array<{ survey_title: string; qid: string; status: string }>;
    expect(rows.map((r) => r.qid)).toEqual(["q1", "q2", "q3"]);
    expect(rows.every((r) => r.survey_title === "Questions: PANT-1" && r.status === "open")).toBe(true);

    const queue = (await app.inject({ method: "GET", url: `/api/decisions?survey=${body.survey_id}` })).json();
    expect(queue).toHaveLength(3);
  });

  it("is idempotent on ticket_id: a repeat returns 200 with the existing survey_id and writes nothing", async () => {
    const first = (await importTicket(TICKET)).json();
    const before = ticketRows("ticket-1");

    const repeat = await importTicket({ ...TICKET, questions: [...TICKET.questions, { qid: "q5", text: "New?", kind: "free-text" }] });

    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toEqual({ ticket_id: "ticket-1", survey_id: first.survey_id });
    expect(ticketRows("ticket-1")).toEqual(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM surveys").get() as { n: number }).n).toBe(1);
  });

  it("returns 422 and writes nothing when no question can be mapped", async () => {
    const res = await importTicket({
      ticket_id: "ticket-2",
      questions: [
        { qid: "q1", text: "Rate it", kind: "rating" },
        { qid: "q2", text: "Pick one", kind: "single-select", options: ["Only"] },
      ],
    });

    expect(res.statusCode).toBe(422);
    expect((db.prepare("SELECT COUNT(*) AS n FROM surveys").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n).toBe(0);
  });

  it("returns 400 for a missing ticket_id or malformed questions", async () => {
    expect((await importTicket({ questions: TICKET.questions })).statusCode).toBe(400);
    expect((await importTicket({ ticket_id: "t" })).statusCode).toBe(400);
    expect((await importTicket({ ticket_id: "t", questions: [{ qid: "q1", kind: "free-text" }] })).statusCode).toBe(400);
    expect((await importTicket({ ticket_id: "t", identifier: 7, questions: TICKET.questions })).statusCode).toBe(400);
  });
});

describe("POST /api/questions/:ticket/close", () => {
  it("closes every open item, keeps decided ones, appends audit rows, and drops them from the queue", async () => {
    const { survey_id, item_ids } = (await importTicket(TICKET)).json();
    const [decided, ...open] = item_ids as string[];
    const verdict = await app.inject({
      method: "POST",
      url: `/api/decisions/${decided}/verdict`,
      payload: { verdict: { kind: "option_chosen", optionId: "B" } },
    });
    expect(verdict.statusCode).toBe(200);

    const res = await closeTicket("ticket-1", { reason: "ticket cancelled" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ticket_id: "ticket-1", survey_id, closed_item_ids: open });

    const statuses = db.prepare("SELECT id, status FROM items WHERE survey_id = ?").all(survey_id) as Array<{ id: string; status: string }>;
    expect(statuses.find((s) => s.id === decided)?.status).toBe("done");
    expect(statuses.filter((s) => s.status === "closed").map((s) => s.id).sort()).toEqual([...open].sort());

    for (const id of open) {
      const audit = db.prepare("SELECT actor, field, old_value, new_value FROM audit_log WHERE item_id = ?").all(id);
      expect(audit).toEqual([{ actor: "upstream", field: "status", old_value: "open", new_value: "closed" }]);
      const comments = db.prepare("SELECT body FROM comments WHERE item_id = ?").all(id);
      expect(comments).toEqual([{ body: "Closed upstream: ticket cancelled" }]);
    }

    // Nothing deleted, but closed items leave the pending queue and stay in ?all=1.
    expect((db.prepare("SELECT COUNT(*) AS n FROM question_links WHERE ticket_id = 'ticket-1'").get() as { n: number }).n).toBe(3);
    expect((await app.inject({ method: "GET", url: `/api/decisions?survey=${survey_id}` })).json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/api/decisions?survey=${survey_id}&all=1` })).json()).toHaveLength(3);
  });

  it("is idempotent: a repeat close returns 200, closes nothing, and adds no audit rows", async () => {
    const { survey_id } = (await importTicket(TICKET)).json();
    await closeTicket("ticket-1", { reason: "answered elsewhere" });
    const auditCount = (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;

    const repeat = await closeTicket("ticket-1", { reason: "answered elsewhere" });

    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toEqual({ ticket_id: "ticket-1", survey_id, closed_item_ids: [] });
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(auditCount);
  });

  it("records the given actor on the audit row", async () => {
    const { item_ids } = (await importTicket(TICKET)).json();
    await closeTicket("ticket-1", { reason: "dup", actor: "pantheon-bot" });
    const row = db.prepare("SELECT actor FROM audit_log WHERE item_id = ?").get(item_ids[0]) as { actor: string };
    expect(row.actor).toBe("pantheon-bot");
  });

  it("refuses a verdict on a closed item with 409", async () => {
    const { item_ids } = (await importTicket(TICKET)).json();
    await closeTicket("ticket-1", { reason: "cancelled" });

    const res = await app.inject({
      method: "POST",
      url: `/api/decisions/${item_ids[0]}/verdict`,
      payload: { verdict: { kind: "accepted" } },
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns 404 for a ticket with no linked survey and 400 without a reason", async () => {
    expect((await closeTicket("nope", { reason: "x" })).statusCode).toBe(404);
    await importTicket(TICKET);
    expect((await closeTicket("ticket-1", {})).statusCode).toBe(400);
    expect((await closeTicket("ticket-1", { reason: "  " })).statusCode).toBe(400);
  });
});
