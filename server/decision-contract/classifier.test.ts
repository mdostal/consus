import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { classifyItem, setTriageOverride } from "./classifier.js";

function insertItem(db: Database.Database, id: string, opts: { decisionPayload?: string; title?: string } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", opts.title ?? "Test item", "open", now, now, opts.decisionPayload ?? null);
}

describe("Decision-type + triage classifier", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("classifies a CBA-shaped payload as decision-type 'cba'", () => {
    insertItem(db, "item-1", {
      decisionPayload: JSON.stringify({
        contractVersion: "decision-request/v1",
        answerShape: "approve",
        question: "Approve CBA?",
        cbaTable: [{ option: "A" }],
      }),
    });

    const result = classifyItem(db, "item-1");
    expect(result.decisionType).toBe("cba");
  });

  it("classifies a choose_one payload as 'choose', a survey payload as 'survey', an edit payload as 'edit'", () => {
    insertItem(db, "item-2", {
      decisionPayload: JSON.stringify({ contractVersion: "decision-request/v1", answerShape: "choose_one", question: "q", choices: ["a", "b"] }),
    });
    insertItem(db, "item-3", {
      decisionPayload: JSON.stringify({ contractVersion: "decision-request/v1", answerShape: "survey", question: "q" }),
    });
    insertItem(db, "item-4", {
      decisionPayload: JSON.stringify({ contractVersion: "decision-request/v1", answerShape: "edit", question: "q" }),
    });

    expect(classifyItem(db, "item-2").decisionType).toBe("choose");
    expect(classifyItem(db, "item-3").decisionType).toBe("survey");
    expect(classifyItem(db, "item-4").decisionType).toBe("edit");
  });

  it("falls back to 'default' when no decision_payload and no other signal matches", () => {
    insertItem(db, "item-5");
    expect(classifyItem(db, "item-5").decisionType).toBe("default");
  });

  it("assigns exactly one triage bucket, defaulting human_request items to open_question", () => {
    insertItem(db, "item-6");
    db.prepare("UPDATE items SET type = 'human_request' WHERE id = 'item-6'").run();

    const result = classifyItem(db, "item-6");
    expect(result.triageBucket).toBe("open_question");
  });

  it("a human-authored override wins over the heuristic bucket assignment", () => {
    insertItem(db, "item-7");
    setTriageOverride(db, { itemId: "item-7", bucket: "noise", author: "mathew" });

    const result = classifyItem(db, "item-7");
    expect(result.triageBucket).toBe("noise");
  });
});
