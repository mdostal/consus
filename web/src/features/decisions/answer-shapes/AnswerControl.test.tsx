import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnswerControl } from "./AnswerControl";
import type {
  CbaPayload,
  ConceptSelectionPayload,
  DecisionPayload,
  EditProposalPayload,
  FeatureSelectionPayload,
  FreeTextPayload,
  RankingPayload,
  RatingPayload,
} from "./types";

const PAYLOAD: DecisionPayload = {
  version: "dostal:decision-request/v1",
  title: "Which DAG engine?",
  context: "ctx",
  options: [
    { id: "A", title: "React Flow", tradeoffs: "+ own the JSON" },
    { id: "B", title: "tldraw", tradeoffs: "+ best canvas" },
  ],
  recommended: "A",
};

const FEATURE_PAYLOAD: FeatureSelectionPayload = {
  version: "dostal:feature-selection/v1",
  title: "Which features?",
  context: "ctx",
  features: [
    { id: "x", name: "Feature X", description: "desc x", default: true },
    { id: "y", name: "Feature Y", description: "desc y", default: false },
  ],
};

describe("AnswerControl — feature-selection/v1 delegation", () => {
  it("renders FeatureChecklist (not the A-Z options list) for feature-selection/v1 payloads", () => {
    render(<AnswerControl payload={FEATURE_PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: /feature x/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm selection/i })).toBeInTheDocument();
    expect(screen.queryByTestId("recommended-badge")).not.toBeInTheDocument();
  });
});

describe("AnswerControl", () => {
  it("renders every option with its tradeoffs, and marks the recommended one", () => {
    render(<AnswerControl payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByText("React Flow")).toBeInTheDocument();
    expect(screen.getByText("+ own the JSON")).toBeInTheDocument();
    expect(screen.getByText("tldraw")).toBeInTheDocument();
    expect(screen.getByTestId("recommended-badge")).toHaveTextContent("A");
  });

  it("accepting fires an 'accepted' verdict", () => {
    const onVerdict = vi.fn();
    render(<AnswerControl payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "accepted" });
  });

  it("choosing a non-recommended option fires an 'option_chosen' verdict", () => {
    const onVerdict = vi.fn();
    render(<AnswerControl payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /choose tldraw/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "option_chosen", optionId: "B" });
  });

  it("mixing multiple options requires a why and fires a 'mix' verdict", () => {
    const onVerdict = vi.fn();
    render(<AnswerControl payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /React Flow/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /tldraw/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /why/i }), { target: { value: "combine both" } });
    fireEvent.click(screen.getByRole("button", { name: /^mix$/i }));

    expect(onVerdict).toHaveBeenCalledWith({ kind: "mix", optionIds: ["A", "B"], why: "combine both" });
  });

  it("rejecting requires commentary and fires a 'rejected_iteration_requested' verdict", () => {
    const onVerdict = vi.fn();
    render(<AnswerControl payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.change(screen.getByRole("textbox", { name: /commentary/i }), { target: { value: "try again" } });
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));

    expect(onVerdict).toHaveBeenCalledWith({ kind: "rejected_iteration_requested", commentary: "try again" });
  });

  describe("s4-edit-and-cba-answer-shapes dispatch", () => {
    const EDIT_PAYLOAD: EditProposalPayload = {
      version: "dostal:edit-proposal/v1",
      title: "Amend the report",
      context: "Tighten the summary.",
      original: "line one\nline two",
      proposed: "line one\nline two, tightened",
    };

    const CBA_PAYLOAD: CbaPayload = {
      version: "dostal:cba/v1",
      title: "Buy vs build",
      context: "Compare the two paths.",
      options: [
        { option: "Buy", cost: "$50k/yr", benefit: "Fast to ship" },
        { option: "Build", cost: "2 eng-months", benefit: "Full control" },
      ],
    };

    it("dispatches an edit-proposal/v1 payload to a real diff view, not the generic options fallback", () => {
      render(<AnswerControl payload={EDIT_PAYLOAD} onVerdict={vi.fn()} />);

      expect(screen.getByTestId("edit-proposal-diff")).toBeInTheDocument();
      expect(screen.queryByTestId("recommended-badge")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^mix$/i })).not.toBeInTheDocument();
    });

    it("dispatches a cba/v1 payload to a structured comparison table, not the generic options fallback", () => {
      render(<AnswerControl payload={CBA_PAYLOAD} onVerdict={vi.fn()} />);

      expect(screen.getByRole("table", { name: /cost\/benefit comparison/i })).toBeInTheDocument();
      expect(screen.getByText("Buy")).toBeInTheDocument();
      expect(screen.getByText("$50k/yr")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^mix$/i })).not.toBeInTheDocument();
    });
  });

  describe("s5-freetext-rating-ranking-answer-shapes dispatch", () => {
    const FREE_TEXT_PAYLOAD: FreeTextPayload = {
      version: "dostal:free-text/v1",
      title: "Feedback",
      context: "Wrap-up.",
      prompt: "Anything else?",
    };

    const RATING_PAYLOAD: RatingPayload = {
      version: "dostal:rating/v1",
      title: "Rate it",
      context: "How'd it go?",
      prompt: "Rate 1-5",
      scale: { min: 1, max: 5 },
    };

    const RANKING_PAYLOAD: RankingPayload = {
      version: "dostal:ranking/v1",
      title: "Rank it",
      context: "Order these.",
      prompt: "Drag to rank",
      items: [
        { id: "a", label: "Option A" },
        { id: "b", label: "Option B" },
      ],
    };

    it("dispatches a free-text/v1 payload to a text response control, not the generic options fallback", () => {
      render(<AnswerControl payload={FREE_TEXT_PAYLOAD} onVerdict={vi.fn()} />);

      expect(screen.getByRole("textbox", { name: /anything else/i })).toBeInTheDocument();
      expect(screen.queryByTestId("recommended-badge")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^mix$/i })).not.toBeInTheDocument();
    });

    it("dispatches a rating/v1 payload to a rating scale control, not the generic options fallback", () => {
      render(<AnswerControl payload={RATING_PAYLOAD} onVerdict={vi.fn()} />);

      expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument();
      expect(screen.queryByTestId("recommended-badge")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^mix$/i })).not.toBeInTheDocument();
    });

    it("dispatches a ranking/v1 payload to a drag-to-reorder list, not the generic options fallback", () => {
      render(<AnswerControl payload={RANKING_PAYLOAD} onVerdict={vi.fn()} />);

      expect(screen.getByTestId("ranking-list")).toBeInTheDocument();
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^mix$/i })).not.toBeInTheDocument();
    });
  });

  describe("s2-concept-selection-answer-shape dispatch", () => {
    const CONCEPT_SELECTION_PAYLOAD: ConceptSelectionPayload = {
      version: "dostal:concept-selection/v1",
      title: "Pick a logo concept",
      context: "Three directions from the brand explorer.",
      concepts: [
        {
          id: "geo",
          name: "Geometric",
          description: "Sharp angular mark.",
          preview: { kind: "svg", markup: "<svg><rect width='10' height='10'/></svg>" },
        },
        {
          id: "script",
          name: "Script",
          description: "Flowing wordmark.",
          preview: { kind: "svg", markup: "<svg><path d='M0 0'/></svg>" },
        },
      ],
    };

    it("dispatches a concept-selection/v1 payload to the concept selection renderer, not the generic options fallback", () => {
      render(<AnswerControl payload={CONCEPT_SELECTION_PAYLOAD} onVerdict={vi.fn()} />);

      expect(screen.getByTestId("concept-selection-list")).toBeInTheDocument();
      expect(screen.getByText("Geometric")).toBeInTheDocument();
      expect(screen.getByText("Script")).toBeInTheDocument();
      expect(screen.queryByTestId("recommended-badge")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^mix$/i })).not.toBeInTheDocument();
    });
  });
});
