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

  describe("optional answerability fields (context, recommended, tradeoffs, research)", () => {
    const research = [{ title: "Quota", body: "The shared key hit its cap twice this week.", sources: ["portunus"] }];

    it("maps a rich single-select onto context, per-option tradeoffs, the recommended letter and research", () => {
      importQuestionTicket(db, {
        ticket_id: "t1",
        questions: [
          {
            qid: "q1",
            text: "Which model by default?",
            kind: "single-select",
            options: ["Claude", "Gemini", "Local"],
            context: "The default decides whose quota every chat burns.",
            recommended: "Gemini",
            tradeoffs: ["Shares the build agents' quota", "Personal key, separate quota", "Free but slow"],
            research,
          },
        ],
      });
      const payload = payloadOf() as {
        context: string;
        recommended: string;
        options: Array<{ id: string; title: string; tradeoffs: string }>;
        research: unknown;
      };
      expect(payload.context).toBe("The default decides whose quota every chat burns.");
      expect(payload.recommended).toBe("B");
      expect(payload.options).toEqual([
        { id: "A", title: "Claude", tradeoffs: "Shares the build agents' quota" },
        { id: "B", title: "Gemini", tradeoffs: "Personal key, separate quota" },
        { id: "C", title: "Local", tradeoffs: "Free but slow" },
      ]);
      expect(payload.research).toEqual(research);
    });

    it("matches `recommended` ignoring case and surrounding space, and falls back to A when it matches nothing", () => {
      importQuestionTicket(db, {
        ticket_id: "t1",
        questions: [
          { qid: "q1", text: "One", kind: "single-select", options: ["Yes", "No"], recommended: "  no " },
          { qid: "q2", text: "Two", kind: "single-select", options: ["Yes", "No"], recommended: "Maybe" },
        ],
      });
      const rows = db.prepare("SELECT title, decision_payload FROM items WHERE decision_payload IS NOT NULL").all() as Array<{
        title: string;
        decision_payload: string;
      }>;
      const rec = Object.fromEntries(rows.map((r) => [r.title, (JSON.parse(r.decision_payload) as { recommended: string }).recommended]));
      expect(rec).toEqual({ One: "B", Two: "A" });
    });

    it("maps multi tradeoffs onto feature descriptions and free-text context", () => {
      importQuestionTicket(db, {
        ticket_id: "t1",
        questions: [
          {
            qid: "q1",
            text: "Which brands?",
            kind: "multi",
            options: ["Acme", "Globex"],
            context: "Each brand needs its own key.",
            tradeoffs: ["Has a key already"],
          },
          { qid: "q2", text: "Anything else?", kind: "free-text", context: "Hermes refuses brands without a key." },
        ],
      });
      const rows = db.prepare("SELECT decision_payload FROM items WHERE decision_payload IS NOT NULL").all() as Array<{
        decision_payload: string;
      }>;
      const [multi, free] = rows.map((r) => JSON.parse(r.decision_payload) as Record<string, unknown>);
      expect(multi.context).toBe("Each brand needs its own key.");
      expect(multi.features).toEqual([
        { id: "f0", name: "Acme", description: "Has a key already" },
        // No tradeoff for this one: the label stands in, as before.
        { id: "f1", name: "Globex", description: "Globex" },
      ]);
      expect(free.context).toBe("Hermes refuses brands without a key.");
      expect(free.prompt).toBe("Anything else?");
    });

    it("leaves a plain question exactly as before", () => {
      importQuestionTicket(db, {
        ticket_id: "t1",
        questions: [{ qid: "q1", text: "Pick one", kind: "single-select", options: ["Yes", "No"] }],
      });
      expect(payloadOf()).toEqual({
        version: "dostal:decision-request/v1",
        title: "Pick one",
        context: "Pick one",
        options: [
          { id: "A", title: "Yes", tradeoffs: "" },
          { id: "B", title: "No", tradeoffs: "" },
        ],
        recommended: "A",
      });
    });

    it("drops malformed optional fields instead of rejecting the question", () => {
      const result = importQuestionTicket(db, {
        ticket_id: "t1",
        questions: [
          {
            qid: "q1",
            text: "Pick one",
            kind: "single-select",
            options: ["Yes", "No"],
            context: 42,
            recommended: ["Yes"],
            tradeoffs: "not an array",
            research: [{ body: "no title" }],
          },
        ],
      });
      expect(result.status).toBe("created");
      const payload = payloadOf();
      expect(payload.context).toBe("Pick one");
      expect(payload.recommended).toBe("A");
      expect(payload).not.toHaveProperty("research");
    });
  });
});
