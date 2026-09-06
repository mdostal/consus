import { describe, it, expect } from "vitest";
import { parseDecisionPayload, serializeDecisionPayload, verdictStatus, verdictSummary } from "./parser.js";

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

  describe("heuristic-from-markdown fallback tier (REQ-23)", () => {
    it("extracts options from '#### Option A — title' headings and a 'recommend' line", () => {
      const ticketBody = [
        "# Wrap vs embed",
        "",
        "Some framing prose about the decision.",
        "",
        "#### Option A — WRAP our shell",
        "+ no upstream dep; - we own the shell",
        "",
        "#### Option B — EMBED our plugins",
        "+ single-pane; - upstream PR required",
        "",
        "We recommend Option A for now.",
      ].join("\n");

      const parsed = parseDecisionPayload(ticketBody);

      expect(parsed?.options).toEqual([
        { id: "A", title: "WRAP our shell", tradeoffs: "" },
        { id: "B", title: "EMBED our plugins", tradeoffs: "" },
      ]);
      expect(parsed?.recommended).toBe("A");
      expect(parsed?.title).toBe("Wrap vs embed");
      expect(parsed?.context).toContain("Some framing prose about the decision.");
    });

    it("extracts options from 'Option A: title' colon-separated headings", () => {
      const ticketBody = [
        "# Wrap vs embed",
        "",
        "Some framing prose about the decision.",
        "",
        "Option A: WRAP our shell",
        "+ no upstream dep; - we own the shell",
        "",
        "Option B: EMBED our plugins",
        "+ single-pane; - upstream PR required",
        "",
        "We recommend Option A for now.",
      ].join("\n");

      const parsed = parseDecisionPayload(ticketBody);

      expect(parsed?.options).toEqual([
        { id: "A", title: "WRAP our shell", tradeoffs: "" },
        { id: "B", title: "EMBED our plugins", tradeoffs: "" },
      ]);
      expect(parsed?.recommended).toBe("A");
    });

    it("extracts options from 'A) TITLE: detail' lines", () => {
      const ticketBody = [
        "Decision: ship strategy",
        "",
        "A) WRAP: keep our own shell, host Multica as a tab",
        "B) EMBED: mount our plugins inside Multica",
        "",
        "Recommendation: B is recommended because upstream is stable.",
      ].join("\n");

      const parsed = parseDecisionPayload(ticketBody);

      expect(parsed?.options).toEqual([
        { id: "A", title: "WRAP", tradeoffs: "keep our own shell, host Multica as a tab" },
        { id: "B", title: "EMBED", tradeoffs: "mount our plugins inside Multica" },
      ]);
      expect(parsed?.recommended).toBe("B");
    });

    it("extracts options from '**A — title**' comparison-table cells", () => {
      const ticketBody = [
        "| Option | Notes |",
        "| --- | --- |",
        "| **A — Wrap** | keeps our shell |",
        "| **B — Embed** | single pane |",
        "",
        "I recommend A.",
      ].join("\n");

      const parsed = parseDecisionPayload(ticketBody);

      expect(parsed?.options).toEqual([
        { id: "A", title: "Wrap", tradeoffs: "" },
        { id: "B", title: "Embed", tradeoffs: "" },
      ]);
      expect(parsed?.recommended).toBe("A");
    });

    it("resolves recommended to the option letter nearest the word 'recommend', not the leftmost letter in the line", () => {
      const ticketBody = [
        "A) WRAP: keep our own shell",
        "B) EMBED: mount inside Multica",
        "",
        "We compared A and B but recommend B.",
      ].join("\n");

      expect(parseDecisionPayload(ticketBody)?.recommended).toBe("B");
    });

    it("does not let a lowercase lettered checklist shadow the real capital-letter options", () => {
      const ticketBody = [
        "a) Configure timeout: 30s",
        "b) Restart service: now",
        "",
        "A) WRAP: keep our own shell",
        "B) EMBED: mount inside Multica",
        "",
        "We recommend A.",
      ].join("\n");

      const parsed = parseDecisionPayload(ticketBody);
      expect(parsed?.options).toEqual([
        { id: "A", title: "WRAP", tradeoffs: "keep our own shell" },
        { id: "B", title: "EMBED", tradeoffs: "mount inside Multica" },
      ]);
    });

    it("returns null when options are found but no 'recommend' line names one of them — agents must always take a position", () => {
      const ticketBody = ["A) WRAP: keep our own shell", "B) EMBED: mount inside Multica", "", "No verdict yet."].join(
        "\n",
      );

      expect(parseDecisionPayload(ticketBody)).toBeNull();
    });

    it("returns null when fewer than 2 heuristic options are found", () => {
      const ticketBody = ["A) WRAP: keep our own shell", "", "I recommend A."].join("\n");

      expect(parseDecisionPayload(ticketBody)).toBeNull();
    });

    it("still prefers the structured tier over the heuristic tier when a valid fenced block is present", () => {
      const ticketBody = [
        "```decision-request",
        JSON.stringify(SAMPLE_PAYLOAD),
        "```",
        "",
        "A) SOMETHING: irrelevant heuristic bait",
        "B) ELSE: more bait",
        "I recommend B.",
      ].join("\n");

      const parsed = parseDecisionPayload(ticketBody);

      expect(parsed?.title).toBe(SAMPLE_PAYLOAD.title);
      expect(parsed?.recommended).toBe("A");
    });

    it("leaves extractionTier unset on a tier-1 (structured) parse", () => {
      const parsed = parseDecisionPayload(JSON.stringify(SAMPLE_PAYLOAD));

      expect(parsed?.extractionTier).toBeUndefined();
      expect(parsed).not.toHaveProperty("extractionTier");
    });

    it("sets extractionTier to \"heuristic\" on a tier-2 parse", () => {
      const ticketBody = [
        "A) WRAP: keep our own shell, host Multica as a tab",
        "B) EMBED: mount our plugins inside Multica",
        "",
        "Recommendation: B is recommended because upstream is stable.",
      ].join("\n");

      const parsed = parseDecisionPayload(ticketBody);

      expect(parsed?.extractionTier).toBe("heuristic");
    });
  });

  describe("research[] field (s1-research-schema-field)", () => {
    it("round-trips a payload that includes research[] through parse -> serialize without loss", () => {
      const payloadWithResearch = {
        ...SAMPLE_PAYLOAD,
        research: [
          { title: "Background", body: "Some findings.", sources: ["https://example.com"] },
          { title: "Prior art", body: "What others did." },
        ],
      };
      const parsed = parseDecisionPayload(JSON.stringify(payloadWithResearch));
      expect(parsed).toEqual(payloadWithResearch);
    });

    it("parses a payload without research[] correctly — backward-compatible", () => {
      const parsed = parseDecisionPayload(JSON.stringify(SAMPLE_PAYLOAD));
      expect(parsed).toEqual(SAMPLE_PAYLOAD);
      expect(parsed?.research).toBeUndefined();
    });

    it("allows ResearchSection to omit sources", () => {
      const payloadWithResearch = {
        ...SAMPLE_PAYLOAD,
        research: [{ title: "Finding", body: "Details without any source links." }],
      };
      const parsed = parseDecisionPayload(JSON.stringify(payloadWithResearch));
      expect(parsed?.research).toEqual([{ title: "Finding", body: "Details without any source links." }]);
      expect(parsed?.research?.[0].sources).toBeUndefined();
    });
  });

  describe("verdictStatus", () => {
    it.each([
      [{ kind: "accepted" as const }, "done"],
      [{ kind: "option_chosen" as const, optionId: "A" }, "done"],
      [{ kind: "mix" as const, optionIds: ["A", "B"], why: "combine" }, "done"],
      [{ kind: "rejected_iteration_requested" as const, commentary: "redo" }, "in_progress"],
      [{ kind: "features_selected" as const, selected: ["dark-mode", "oauth"] }, "done"],
    ] as const)("maps %o to status %s", (verdict, expected) => {
      expect(verdictStatus(verdict)).toBe(expected);
    });
  });

  describe("verdictSummary", () => {
    it("summarizes an accepted verdict", () => {
      expect(verdictSummary({ kind: "accepted" })).toBe("Accepted the recommended option.");
    });

    it("summarizes an option_chosen verdict", () => {
      expect(verdictSummary({ kind: "option_chosen", optionId: "B" })).toBe("Chose option B.");
    });

    it("summarizes a mix verdict", () => {
      expect(verdictSummary({ kind: "mix", optionIds: ["A", "C"], why: "best of both" })).toBe(
        "Mixed options A + C — best of both",
      );
    });

    it("summarizes a rejected_iteration_requested verdict", () => {
      expect(verdictSummary({ kind: "rejected_iteration_requested", commentary: "needs work" })).toBe(
        "Requested another round — needs work",
      );
    });

    it("summarizes a features_selected verdict listing the selected feature ids", () => {
      expect(verdictSummary({ kind: "features_selected", selected: ["dark-mode", "oauth", "2fa"] })).toBe(
        "Selected features: dark-mode, oauth, 2fa",
      );
    });
  });

  describe("FeatureSelectionPayload", () => {
    it("validates a well-formed feature-selection/v1 payload is accepted by the type", () => {
      const payload = {
        version: "dostal:feature-selection/v1" as const,
        title: "Pick your features",
        context: "Choose the features to enable.",
        features: [
          { id: "dark-mode", name: "Dark Mode", description: "Switch to dark theme." },
          { id: "oauth", name: "OAuth Login", description: "Sign in with Google/GitHub.", default: true },
        ],
      };
      expect(payload.version).toBe("dostal:feature-selection/v1");
      expect(payload.features).toHaveLength(2);
      expect(payload.features[1].default).toBe(true);
    });
  });
});
