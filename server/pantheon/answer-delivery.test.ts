import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { importQuestionTicket } from "../questions/import.js";
import {
  getQuestionLink,
  postQuestionVerdict,
  enqueueQuestionVerdict,
  questionAnswerFor,
  redeliverQuestionDeliveries,
  type AnswerDeliveryOptions,
} from "./answer-delivery.js";

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

describe("getQuestionLink", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("returns null for an item with no question link", () => {
    expect(getQuestionLink(db, "no-such-item")).toBeNull();
  });

  it("returns the link for an imported question item", () => {
    importQuestionTicket(db, { ticket_id: "ticket-abc", questions: [{ qid: "myqid", text: "Q?", kind: "free-text" }] });

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
    importQuestionTicket(db, {
      ticket_id: "ticket-1",
      questions: [
        { qid: "q1", text: "Pick one", kind: "single-select", options: ["Yes", "No"] },
        { qid: "q2", text: "Why?", kind: "free-text" },
      ],
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
    const opts: AnswerDeliveryOptions = {
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
    const opts: AnswerDeliveryOptions = {
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
    const opts: AnswerDeliveryOptions = {
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
    const opts: AnswerDeliveryOptions = {
      pantheonApiUrl: "http://pantheon:8800",
      fetch: makeFakeFetch([], calls),
    };

    await postQuestionVerdict(db, "no-such-item", { kind: "accepted" }, "Mathew", opts);
    expect(calls).toHaveLength(0);
  });
});

describe("PANT-807: question delivery outbox", () => {
  let db: Database.Database;
  const PANTHEON = "http://pantheon:8800";

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    importQuestionTicket(db, {
      ticket_id: "ticket-1",
      questions: [
        { qid: "q1", text: "Pick one", kind: "single-select", options: ["Yes", "No"] },
        { qid: "q2", text: "Why?", kind: "free-text" },
      ],
    });
    importQuestionTicket(db, {
      ticket_id: "ticket-2",
      questions: [{ qid: "f1", text: "Features?", kind: "multi", options: ["X", "Y"] }],
    });
  });

  function itemFor(qid: string): string {
    return (db.prepare("SELECT item_id FROM question_links WHERE qid = ?").get(qid) as { item_id: string }).item_id;
  }

  function decide(qid: string) {
    db.prepare("UPDATE items SET decided_at = ?, status = 'done' WHERE id = ?").run(new Date().toISOString(), itemFor(qid));
  }

  function deliveries() {
    return db
      .prepare("SELECT ticket_id, qid, kind, body, status, attempts, last_error FROM question_deliveries ORDER BY id")
      .all() as Array<{
      ticket_id: string;
      qid: string | null;
      kind: string;
      body: string;
      status: string;
      attempts: number;
      last_error: string | null;
    }>;
  }

  it("a 500 on /partial leaves a failed row with attempts=1, and redeliver delivers it on the next success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: CapturedCall[] = [];
    decide("q1");

    const r1 = await postQuestionVerdict(db, itemFor("q1"), { kind: "option_chosen", optionId: "B" }, "Mathew", {
      pantheonApiUrl: PANTHEON,
      fetch: makeFakeFetch([{ status: 500 }], calls),
    });

    expect(r1).toEqual({ delivered: 0, failed: 1, skipped: 0 });
    expect(deliveries()).toEqual([
      expect.objectContaining({ kind: "partial", qid: "q1", status: "failed", attempts: 1, last_error: "HTTP 500" }),
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[answer-delivery] Pantheon delivery failed",
      expect.objectContaining({ ticket: "ticket-1", qid: "q1" }),
    );

    const retryCalls: CapturedCall[] = [];
    const r2 = await redeliverQuestionDeliveries(db, {
      pantheonApiUrl: PANTHEON,
      fetch: makeFakeFetch([{ status: 200 }], retryCalls),
    });

    expect(r2).toEqual({ delivered: 1, failed: 0, skipped: 0 });
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0].url).toBe(`${PANTHEON}/api/feed/questions/ticket-1/partial`);
    expect(JSON.parse(retryCalls[0].init.body as string)).toEqual({ qid: "q1", answer: "B", actor: "Mathew" });
    expect(deliveries()[0]).toMatchObject({ status: "delivered", attempts: 2, last_error: null });
    warn.mockRestore();
  });

  it("records a thrown network error as failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    decide("q1");
    await postQuestionVerdict(db, itemFor("q1"), { kind: "option_chosen", optionId: "A" }, "Mathew", {
      pantheonApiUrl: PANTHEON,
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    expect(deliveries()[0]).toMatchObject({ status: "failed", attempts: 1, last_error: "ECONNREFUSED" });
    warn.mockRestore();
  });

  it("two verdicts after all members are answered produce one /submit call", async () => {
    const calls: CapturedCall[] = [];
    const opts: AnswerDeliveryOptions = { pantheonApiUrl: PANTHEON, fetch: makeFakeFetch([], calls) };
    decide("q1");
    decide("q2");

    await postQuestionVerdict(db, itemFor("q2"), { kind: "text_response", text: "first" }, "Mathew", opts);
    // Re-decide (e.g. after a reopen) — the survey is still fully answered.
    await postQuestionVerdict(db, itemFor("q2"), { kind: "text_response", text: "second" }, "Mathew", opts);

    expect(calls.filter((c) => c.url.endsWith("/submit"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/partial"))).toHaveLength(2);
    expect(deliveries().filter((d) => d.kind === "submit")).toHaveLength(1);
  });

  it("holds submit back while the ticket has an undelivered partial, then sends it after the partial", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    decide("q1");
    decide("q2");
    const calls: CapturedCall[] = [];
    const r1 = await postQuestionVerdict(db, itemFor("q2"), { kind: "text_response", text: "x" }, "Mathew", {
      pantheonApiUrl: PANTHEON,
      fetch: makeFakeFetch([{ status: 503 }], calls),
    });
    expect(r1).toEqual({ delivered: 0, failed: 1, skipped: 1 });
    expect(calls.map((c) => c.url)).toEqual([`${PANTHEON}/api/feed/questions/ticket-1/partial`]);

    const retry: CapturedCall[] = [];
    await redeliverQuestionDeliveries(db, { pantheonApiUrl: PANTHEON, fetch: makeFakeFetch([], retry) });
    expect(retry.map((c) => c.url.split("/").pop())).toEqual(["partial", "submit"]);
    expect(deliveries().every((d) => d.status === "delivered")).toBe(true);
    warn.mockRestore();
  });

  it("a newer verdict overwrites an undelivered partial so redelivery never sends a stale answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    decide("q1");
    await postQuestionVerdict(db, itemFor("q1"), { kind: "option_chosen", optionId: "A" }, "Mathew", {
      pantheonApiUrl: PANTHEON,
      fetch: makeFakeFetch([{ status: 500 }], []),
    });
    await postQuestionVerdict(db, itemFor("q1"), { kind: "option_chosen", optionId: "B" }, "Mathew", {
      pantheonApiUrl: PANTHEON,
      fetch: makeFakeFetch([{ status: 500 }], []),
    });

    const rows = deliveries();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].body).answer).toBe("B");
    expect(rows[0].attempts).toBe(2);
    warn.mockRestore();
  });

  it("does not enqueue anything for an item with no question link", () => {
    expect(db.transaction(() => enqueueQuestionVerdict(db, "nope", { kind: "accepted" }, "M"))()).toEqual([]);
    expect(deliveries()).toEqual([]);
  });

  describe("verdict → answer", () => {
    it("accepted on a decision-request answers with the recommended option", () => {
      expect(questionAnswerFor(db, itemFor("q1"), { kind: "accepted" })).toBe("A");
    });

    it("refuses accepted on free-text and feature-selection payloads", () => {
      expect(questionAnswerFor(db, itemFor("q2"), { kind: "accepted" })).toBeNull();
      expect(questionAnswerFor(db, itemFor("f1"), { kind: "accepted" })).toBeNull();
      expect(() => enqueueQuestionVerdict(db, itemFor("q2"), { kind: "accepted" }, "M")).toThrow(/no answer/);
      expect(deliveries()).toEqual([]);
    });

    it("maps the payload-specific verdicts", () => {
      expect(questionAnswerFor(db, itemFor("f1"), { kind: "features_selected", selected: ["f0", "f1"] })).toBe("f0, f1");
      expect(questionAnswerFor(db, itemFor("q2"), { kind: "text_response", text: "hi" })).toBe("hi");
    });
  });
});
