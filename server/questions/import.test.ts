import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { importQuestionTicket } from "./import.js";

describe("importQuestionTicket", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  function payloadOf(): Record<string, unknown> {
    const item = db.prepare("SELECT decision_payload FROM items WHERE decision_payload IS NOT NULL").get() as {
      decision_payload: string;
    };
    return JSON.parse(item.decision_payload) as Record<string, unknown>;
  }

  it("creates one survey and one item per question for a single-select ticket", () => {
    const result = importQuestionTicket(db, {
      ticket_id: "t1",
      questions: [{ qid: "q1", text: "Pick one", kind: "single-select", options: ["Yes", "No"] }],
    });
    expect(result.status).toBe("created");

    expect(db.prepare("SELECT * FROM surveys").all()).toHaveLength(1);
    const items = db.prepare("SELECT id, title FROM items WHERE decision_payload IS NOT NULL").all() as Array<{
      id: string;
      title: string;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Pick one");

    const payload = payloadOf() as { version: string; options: unknown[] };
    expect(payload.version).toBe("dostal:decision-request/v1");
    expect(payload.options).toHaveLength(2);

    const link = db.prepare("SELECT ticket_id, qid FROM question_links WHERE item_id = ?").get(items[0].id);
    expect(link).toEqual({ ticket_id: "t1", qid: "q1" });
  });

  it("maps multi-kind to feature-selection/v1", () => {
    importQuestionTicket(db, {
      ticket_id: "t2",
      questions: [{ qid: "q1", text: "Pick features", kind: "multi", options: ["A", "B", "C"] }],
    });
    const payload = payloadOf() as { version: string; features: unknown[] };
    expect(payload.version).toBe("dostal:feature-selection/v1");
    expect(payload.features).toHaveLength(3);
  });

  it("maps free-text kind to free-text/v1", () => {
    importQuestionTicket(db, { ticket_id: "t3", questions: [{ qid: "q1", text: "What do you think?", kind: "free-text" }] });
    const payload = payloadOf() as { version: string; prompt: string };
    expect(payload.version).toBe("dostal:free-text/v1");
    expect(payload.prompt).toBe("What do you think?");
  });

  it("is idempotent — importing the same ticket again creates no duplicates", () => {
    const ticket = {
      ticket_id: "t1",
      questions: [{ qid: "q1", text: "Pick one", kind: "single-select", options: ["Yes", "No"] }],
    };
    const first = importQuestionTicket(db, ticket);
    const second = importQuestionTicket(db, ticket);

    expect(first.status).toBe("created");
    expect(second).toEqual({ status: "exists", surveyId: (first as { surveyId: string }).surveyId });
    expect(db.prepare("SELECT COUNT(*) AS n FROM surveys").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM question_links").get()).toEqual({ n: 1 });
  });

  it("creates multiple items for a ticket with multiple questions", () => {
    importQuestionTicket(db, {
      ticket_id: "t1",
      questions: [
        { qid: "q1", text: "Pick one", kind: "single-select", options: ["A", "B"] },
        { qid: "q2", text: "Any extras?", kind: "free-text" },
      ],
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM surveys").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM items WHERE decision_payload IS NOT NULL").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM question_links").get()).toEqual({ n: 2 });
  });
});
