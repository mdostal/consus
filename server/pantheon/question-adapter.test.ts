import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import {
  pullQuestions,
  getQuestionLink,
  postQuestionVerdict,
  type QuestionAdapterOptions,
} from "./question-adapter.js";

type CapturedCall = { url: string; init: RequestInit };

function makeFakeFetch(
  responses: Array<{ status?: number; body?: unknown }>,
  captured: CapturedCall[],
): typeof globalThis.fetch {
  let i = 0;
  return (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    const r = responses[i++] ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 }),
    );
  };
}

function makeQuestionFeed(tickets: Array<{
  ticket_id?: string;
  identifier?: string;
  status?: string;
  questions: Array<{ qid: string; text: string; kind: string; options?: string[] }>;
}>) {
  return {
    questions: tickets.map((t, i) => ({
      ticket_id: t.ticket_id ?? `ticket-${i + 1}`,
      identifier: t.identifier ?? null,
      status: t.status ?? "todo",
      questions: t.questions,
    })),
  };
}

describe("pullQuestions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("creates one survey and one item per question for a single-select ticket", async () => {
    const calls: CapturedCall[] = [];
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch(
        [{ status: 200, body: makeQuestionFeed([{
          ticket_id: "t1",
          questions: [{ qid: "q1", text: "Pick one", kind: "single-select", options: ["Yes", "No"] }],
        }]) }],
        calls,
      ),
    };

    const result = await pullQuestions(db, opts);
    expect(result.surveysCreated).toBe(1);

    const surveys = db.prepare("SELECT * FROM surveys").all();
    expect(surveys).toHaveLength(1);

    const items = db.prepare("SELECT * FROM items WHERE decision_payload IS NOT NULL").all() as Array<{
      id: string;
      title: string;
      decision_payload: string;
      survey_id: string;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Pick one");

    const payload = JSON.parse(items[0].decision_payload) as { version: string; options: unknown[] };
    expect(payload.version).toBe("dostal:decision-request/v1");
    expect(payload.options).toHaveLength(2);

    const link = db.prepare("SELECT * FROM question_links WHERE item_id = ?").get(items[0].id) as {
      ticket_id: string;
      qid: string;
    };
    expect(link.ticket_id).toBe("t1");
    expect(link.qid).toBe("q1");
  });

  it("maps multi-kind to feature-selection/v1", async () => {
    const calls: CapturedCall[] = [];
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch(
        [{ status: 200, body: makeQuestionFeed([{
          ticket_id: "t2",
          questions: [{ qid: "q1", text: "Pick features", kind: "multi", options: ["A", "B", "C"] }],
        }]) }],
        calls,
      ),
    };

    await pullQuestions(db, opts);

    const item = db.prepare("SELECT decision_payload FROM items WHERE decision_payload IS NOT NULL").get() as {
      decision_payload: string;
    };
    const payload = JSON.parse(item.decision_payload) as { version: string; features: unknown[] };
    expect(payload.version).toBe("dostal:feature-selection/v1");
    expect(payload.features).toHaveLength(3);
  });

  it("maps free-text kind to free-text/v1", async () => {
    const calls: CapturedCall[] = [];
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch(
        [{ status: 200, body: makeQuestionFeed([{
          ticket_id: "t3",
          questions: [{ qid: "q1", text: "What do you think?", kind: "free-text" }],
        }]) }],
        calls,
      ),
    };

    await pullQuestions(db, opts);

    const item = db.prepare("SELECT decision_payload FROM items WHERE decision_payload IS NOT NULL").get() as {
      decision_payload: string;
    };
    const payload = JSON.parse(item.decision_payload) as { version: string; prompt: string };
    expect(payload.version).toBe("dostal:free-text/v1");
    expect(payload.prompt).toBe("What do you think?");
  });

  it("is idempotent — re-pulling the same ticket creates no duplicates", async () => {
    const feed = makeQuestionFeed([{
      ticket_id: "t1",
      questions: [{ qid: "q1", text: "Pick one", kind: "single-select", options: ["Yes", "No"] }],
    }]);
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch(
        [
          { status: 200, body: feed },
          { status: 200, body: feed },
        ],
        [],
      ),
    };

    await pullQuestions(db, opts);
    const r2 = await pullQuestions(db, opts);

    expect(r2.surveysCreated).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM surveys").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM question_links").get()).toEqual({ n: 1 });
  });

  it("creates multiple items for a ticket with multiple questions", async () => {
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch(
        [{ status: 200, body: makeQuestionFeed([{
          ticket_id: "t1",
          questions: [
            { qid: "q1", text: "Pick one", kind: "single-select", options: ["A", "B"] },
            { qid: "q2", text: "Any extras?", kind: "free-text" },
          ],
        }]) }],
        [],
      ),
    };

    await pullQuestions(db, opts);

    expect(db.prepare("SELECT COUNT(*) AS n FROM surveys").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM items WHERE decision_payload IS NOT NULL").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM question_links").get()).toEqual({ n: 2 });
  });

  it("throws on a non-ok feed response", async () => {
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch([{ status: 502, body: { error: "upstream down" } }], []),
    };

    await expect(pullQuestions(db, opts)).rejects.toThrow("502");
  });
});

describe("getQuestionLink", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("returns null for an item with no question link", () => {
    expect(getQuestionLink(db, "no-such-item")).toBeNull();
  });

  it("returns the link for an item that was created by pullQuestions", async () => {
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch(
        [{ status: 200, body: makeQuestionFeed([{
          ticket_id: "ticket-abc",
          questions: [{ qid: "myqid", text: "Q?", kind: "free-text" }],
        }]) }],
        [],
      ),
    };
    await pullQuestions(db, opts);

    const item = db.prepare("SELECT id FROM items WHERE decision_payload IS NOT NULL").get() as { id: string };
    const link = getQuestionLink(db, item.id);
    expect(link).toMatchObject({ ticketId: "ticket-abc", qid: "myqid" });
  });
});

describe("postQuestionVerdict", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);

    // Seed a two-question ticket
    await pullQuestions(db, {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch(
        [{ status: 200, body: makeQuestionFeed([{
          ticket_id: "ticket-1",
          questions: [
            { qid: "q1", text: "Pick one", kind: "single-select", options: ["Yes", "No"] },
            { qid: "q2", text: "Why?", kind: "free-text" },
          ],
        }]) }],
        [],
      ),
    });
  });

  function getItems() {
    return db
      .prepare("SELECT id, qid FROM question_links JOIN items ON question_links.item_id = items.id ORDER BY qid ASC")
      .all() as Array<{ id: string; qid: string }>;
  }

  function setDecidedAt(itemId: string) {
    db.prepare("UPDATE items SET decided_at = ?, status = 'done' WHERE id = ?").run(
      new Date().toISOString(),
      itemId,
    );
  }

  it("posts a partial when the first item is decided", async () => {
    const calls: CapturedCall[] = [];
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }], calls),
    };

    const items = getItems();
    const q1Item = items.find((i) => i.qid === "q1")!;

    setDecidedAt(q1Item.id);

    await postQuestionVerdict(db, q1Item.id, { kind: "option_chosen", optionId: "A" }, "Mathew", opts);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://pantheon:8800/api/feed/questions/ticket-1/partial");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.qid).toBe("q1");
    expect(body.answer).toBe("A");
    expect(body.actor).toBe("Mathew");
  });

  it("posts partial AND submit when the last item is decided", async () => {
    const calls: CapturedCall[] = [];
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch([
        { status: 200, body: {} }, // partial for q2
        { status: 200, body: {} }, // submit
      ], calls),
    };

    const items = getItems();
    const q1Item = items.find((i) => i.qid === "q1")!;
    const q2Item = items.find((i) => i.qid === "q2")!;

    // q1 already answered
    setDecidedAt(q1Item.id);

    // q2 is the last item — decided now
    setDecidedAt(q2Item.id);

    await postQuestionVerdict(db, q2Item.id, { kind: "text_response", text: "Because reasons" }, "Mathew", opts);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/partial");
    expect(calls[1].url).toBe("http://pantheon:8800/api/feed/questions/ticket-1/submit");
    const submitBody = JSON.parse(calls[1].init.body as string);
    expect(submitBody.actor).toBe("Mathew");
  });

  it("posts text_response as the answer string", async () => {
    const calls: CapturedCall[] = [];
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch([{ status: 200, body: {} }], calls),
    };

    const items = getItems();
    const q2Item = items.find((i) => i.qid === "q2")!;
    setDecidedAt(q2Item.id);

    await postQuestionVerdict(db, q2Item.id, { kind: "text_response", text: "My answer" }, "Mathew", opts);

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.answer).toBe("My answer");
  });

  it("does nothing for an item with no question link", async () => {
    const calls: CapturedCall[] = [];
    const opts: QuestionAdapterOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch([], calls),
    };

    await postQuestionVerdict(db, "no-such-item", { kind: "accepted" }, "Mathew", opts);
    expect(calls).toHaveLength(0);
  });
});
