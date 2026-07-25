import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { ingestQuestion, answerHumanRequest, getHumanRequest } from "./index.js";
import type { MinervaTransport } from "./transport.js";

function fakeTransport(): MinervaTransport & { calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    async invoke(method, params) {
      calls.push({ method, params });
      if (method === "capabilities") {
        return { ok: true, result: { abi_version: "1.0.0" } };
      }
      if (method === "answerQuestion") {
        return { ok: true, result: { acknowledged: true } };
      }
      return { ok: false, recoverable: false, code: "UNKNOWN_METHOD", message: `unknown: ${method}` };
    },
  };
}

describe("Minerva Adapter — Question bridge", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("ingests a Question preserving id, text, channel, reason verbatim", () => {
    ingestQuestion(db, {
      id: "q-1",
      text: "Should we adopt React Flow for the DAG viewer?",
      channel: "architecture",
      reason: "unclear precedent",
      status: "open",
    });

    const stored = getHumanRequest(db, "q-1");
    expect(stored).toMatchObject({
      minerva_question_id: "q-1",
      text: "Should we adopt React Flow for the DAG viewer?",
      channel: "architecture",
      reason: "unclear precedent",
      status: "open",
    });
  });

  it("stores classifier confidence and suggested_channel when provided", () => {
    ingestQuestion(db, {
      id: "q-2",
      text: "Approve the CBA?",
      channel: "cba",
      reason: "policy-flagged",
      status: "open",
      confidence: 0.82,
      suggestedChannel: "cba",
    });

    const stored = getHumanRequest(db, "q-2");
    expect(stored?.confidence).toBeCloseTo(0.82);
    expect(stored?.suggested_channel).toBe("cba");
  });

  it("falls back to a default/catch-all queue for an unknown channel rather than dropping the question", () => {
    ingestQuestion(db, {
      id: "q-3",
      text: "Unrecognized channel test",
      channel: "totally-new-channel-type",
      reason: "n/a",
      status: "open",
    });

    const stored = getHumanRequest(db, "q-3");
    expect(stored).toBeDefined();
    expect(stored?.channel).toBe("totally-new-channel-type");
  });

  it("populates a decision_payload translation (yes_no shape) so it renders through the shared decision card", () => {
    ingestQuestion(db, {
      id: "q-4",
      text: "Ship v1 with the flex-scope KB backlog cut?",
      channel: "scope",
      reason: "operator call",
      status: "open",
    });

    const item = db.prepare("SELECT decision_payload FROM items WHERE id = ?").get("human_request:q-4") as
      | { decision_payload: string | null }
      | undefined;
    expect(item?.decision_payload).toBeTruthy();
    const payload = JSON.parse(item!.decision_payload as string);
    expect(payload.answerShape).toBe("yes_no");
    expect(payload.question).toBe("Ship v1 with the flex-scope KB backlog cut?");
  });

  it("syncs status back to Minerva when a human_request is answered in Delphi", async () => {
    ingestQuestion(db, { id: "q-5", text: "Test", channel: "general", reason: "n/a", status: "open" });
    const transport = fakeTransport();

    await answerHumanRequest(db, transport, { minervaQuestionId: "q-5", answer: "yes" });

    const stored = getHumanRequest(db, "q-5");
    expect(stored?.status).toBe("answered");
    expect(transport.calls).toContainEqual({
      method: "answerQuestion",
      params: { id: "q-5", answer: "yes" },
    });
  });
});
