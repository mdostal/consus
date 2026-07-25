import { describe, it, expect } from "vitest";
import { parseDecisionPayload, serializeDecisionPayload, resolveAnswerShape } from "./parser.js";

describe("decision-request/v1 parser", () => {
  it("round-trips a payload through parse -> serialize without loss", () => {
    const payload = {
      contractVersion: "decision-request/v1" as const,
      answerShape: "choose_one" as const,
      question: "Which DAG engine?",
      choices: ["React Flow", "tldraw", "Excalidraw"],
    };

    const serialized = serializeDecisionPayload(payload);
    const parsed = parseDecisionPayload(serialized);

    expect(parsed).toEqual(payload);
  });

  it("parses a fenced JSON block from a ticket body", () => {
    const ticketBody = [
      "Some prose before the block.",
      "```json",
      JSON.stringify({ contractVersion: "decision-request/v1", answerShape: "yes_no", question: "Ship it?" }),
      "```",
      "Some prose after.",
    ].join("\n");

    const parsed = parseDecisionPayload(ticketBody);

    expect(parsed?.question).toBe("Ship it?");
    expect(parsed?.answerShape).toBe("yes_no");
  });

  it("returns null for content with no fenced JSON block rather than throwing", () => {
    expect(parseDecisionPayload("just plain prose, no JSON here")).toBeNull();
  });

  describe("resolveAnswerShape", () => {
    it.each([
      ["yes_no", "yes_no"],
      ["choose_one", "choose_one"],
      ["survey", "survey"],
      ["edit", "edit"],
      ["approve", "approve"],
    ] as const)("resolves %s payloads to the %s control", (shape, expected) => {
      const resolved = resolveAnswerShape({
        contractVersion: "decision-request/v1",
        answerShape: shape,
        question: "q",
      });
      expect(resolved).toBe(expected);
    });

    it("returns null for an item with no decision_payload — falls back to the generic item view", () => {
      expect(resolveAnswerShape(null)).toBeNull();
    });
  });
});
