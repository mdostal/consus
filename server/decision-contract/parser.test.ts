import { describe, it, expect } from "vitest";
import { parseDecisionPayload, serializeDecisionPayload, verdictStatus } from "./parser.js";

const SAMPLE_PAYLOAD = {
  version: "dostal:decision-request/v1" as const,
  title: "Wrap Multica in our shell vs embed our stack into Multica",
  context: "Why this decision exists.",
  options: [
    { id: "A", title: "WRAP — our shell hosts Multica as one tab", tradeoffs: "+ no upstream dep; - we own the shell" },
    { id: "B", title: "EMBED — our plugins mount inside Multica", tradeoffs: "+ single-pane; - upstream PR required" },
  ],
  recommended: "A",
};

describe("decision-request/v1 parser", () => {
  it("round-trips a payload through parse -> serialize without loss", () => {
    const serialized = serializeDecisionPayload(SAMPLE_PAYLOAD);
    const parsed = parseDecisionPayload(serialized);

    expect(parsed).toEqual(SAMPLE_PAYLOAD);
  });

  it("parses a fenced ```decision-request block from a ticket body", () => {
    const ticketBody = [
      "Some prose before the block.",
      "```decision-request",
      JSON.stringify(SAMPLE_PAYLOAD),
      "```",
      "Some prose after.",
    ].join("\n");

    const parsed = parseDecisionPayload(ticketBody);

    expect(parsed?.title).toBe(SAMPLE_PAYLOAD.title);
    expect(parsed?.options).toHaveLength(2);
    expect(parsed?.recommended).toBe("A");
  });

  it("returns null for content with no fenced decision-request block rather than throwing", () => {
    expect(parseDecisionPayload("just plain prose, no JSON here")).toBeNull();
  });

  it("returns null when recommended is missing — agents must always take a position", () => {
    const { recommended, ...withoutRecommended } = SAMPLE_PAYLOAD;
    void recommended;
    expect(parseDecisionPayload(JSON.stringify(withoutRecommended))).toBeNull();
  });

  it("returns null when fewer than 2 options are given", () => {
    expect(parseDecisionPayload(JSON.stringify({ ...SAMPLE_PAYLOAD, options: [SAMPLE_PAYLOAD.options[0]] }))).toBeNull();
  });

  describe("verdictStatus", () => {
    it.each([
      [{ kind: "accepted" as const }, "done"],
      [{ kind: "option_chosen" as const, optionId: "A" }, "done"],
      [{ kind: "mix" as const, optionIds: ["A", "B"], why: "combine" }, "done"],
      [{ kind: "rejected_iteration_requested" as const, commentary: "redo" }, "in_progress"],
    ] as const)("maps %o to status %s", (verdict, expected) => {
      expect(verdictStatus(verdict)).toBe(expected);
    });
  });
});
