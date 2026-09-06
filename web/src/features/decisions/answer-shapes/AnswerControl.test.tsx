import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnswerControl } from "./AnswerControl";
import type { CbaPayload, DecisionPayload, EditProposalPayload, FeatureSelectionPayload } from "./types";

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
});
