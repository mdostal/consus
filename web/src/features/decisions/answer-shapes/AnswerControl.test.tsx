import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnswerControl } from "./AnswerControl";
import type { DecisionPayload } from "./types";

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
});
