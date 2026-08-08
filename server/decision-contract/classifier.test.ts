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

const OPTIONS = [
  { id: "A", title: "Option A", tradeoffs: "+ pro; - con" },
  { id: "B", title: "Option B", tradeoffs: "+ pro; - con" },
];

describe("Decision-type + triage classifier", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("classifies a decision_payload with diagram:true as decision-type 'cba'", () => {
    insertItem(db, "item-1", {
      decisionPayload: JSON.stringify({
        version: "dostal:decision-request/v1",
        title: "Approve CBA?",
        context: "ctx",
        options: OPTIONS,
        recommended: "A",
        diagram: true,
      }),
    });

    const result = classifyItem(db, "item-1");
    expect(result.decisionType).toBe("cba");
  });

  it("classifies any other valid decision_payload as 'choose' — the real contract is always option-based", () => {
    insertItem(db, "item-2", {
      decisionPayload: JSON.stringify({
        version: "dostal:decision-request/v1",
        title: "Choose an option",
        context: "ctx",
        options: OPTIONS,
        recommended: "A",
      }),
    });

    expect(classifyItem(db, "item-2").decisionType).toBe("choose");
  });

  it("falls back to 'default' decision-type when no decision_payload and no title keyword matches", () => {
    insertItem(db, "item-5", { title: "Rotate the staging DB credentials" });
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

  describe("REQ-22: legacy heuristic fallback (no decision_payload)", () => {
    it("classifies a CBA-shaped title as decision-type 'cba'", () => {
      insertItem(db, "item-cba", { title: "CBA: microservices vs. monolith trade-off" });
      expect(classifyItem(db, "item-cba").decisionType).toBe("cba");
    });

    it("classifies a quorum-shaped title as decision-type 'quorum'", () => {
      insertItem(db, "item-quorum", { title: "Agents are split 2-2, needs a tie-break" });
      expect(classifyItem(db, "item-quorum").decisionType).toBe("quorum");
    });

    it("classifies a choose-shaped title as decision-type 'choose'", () => {
      insertItem(db, "item-choose", { title: "Which approach should we take for auth?" });
      expect(classifyItem(db, "item-choose").decisionType).toBe("choose");
    });

    it("classifies a survey-shaped title as decision-type 'survey'", () => {
      insertItem(db, "item-survey", { title: "Checklist of features to enable" });
      expect(classifyItem(db, "item-survey").decisionType).toBe("survey");
    });

    it("classifies an edit-shaped title as decision-type 'edit'", () => {
      insertItem(db, "item-edit", { title: "Weekly ops report needs a proofread" });
      expect(classifyItem(db, "item-edit").decisionType).toBe("edit");
    });

    it("is first-match-wins: cba is checked before choose", () => {
      insertItem(db, "item-both", { title: "CBA needed — choose the recommended option" });
      expect(classifyItem(db, "item-both").decisionType).toBe("cba");
    });

    it("matches keywords case-insensitively", () => {
      insertItem(db, "item-case", { title: "QUORUM reached, tiebreak required" });
      expect(classifyItem(db, "item-case").decisionType).toBe("quorum");
    });

    it("defaults an unmatched item's triage bucket to 'agent_task', not 'research_plan'", () => {
      insertItem(db, "item-default-bucket", { title: "Rotate the staging DB credentials" });
      const result = classifyItem(db, "item-default-bucket");
      expect(result.decisionType).toBe("default");
      expect(result.triageBucket).toBe("agent_task");
    });

    it("routes a decision-shaped title to the open_question bucket even without a payload", () => {
      insertItem(db, "item-decision-bucket", { title: "Which approach should we take for auth?" });
      const result = classifyItem(db, "item-decision-bucket");
      expect(result.decisionType).toBe("choose");
      expect(result.triageBucket).toBe("open_question");
    });
  });
});
