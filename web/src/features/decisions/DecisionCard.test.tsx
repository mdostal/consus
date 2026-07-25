import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionCard } from "./DecisionCard";

describe("DecisionCard", () => {
  it("renders a question, a recommendation, and an answer slot (go/no-go pattern)", () => {
    render(
      <DecisionCard
        question="Ship v1 with the flex-scope KB backlog cut?"
        recommendation="Recommend: yes, ship without it."
        payload={{ contractVersion: "decision-request/v1", answerShape: "yes_no", question: "Ship v1?" }}
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByText(/Ship v1 with the flex-scope KB backlog cut\?/)).toBeInTheDocument();
    expect(screen.getByText(/Recommend: yes, ship without it\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /yes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no/i })).toBeInTheDocument();
  });

  it("renders a status/severity pill when provided, not buried in prose", () => {
    render(
      <DecisionCard
        question="q"
        payload={{ contractVersion: "decision-request/v1", answerShape: "approve", question: "q" }}
        status="P0"
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByTestId("status-pill")).toHaveTextContent("P0");
  });

  it("renders a long source doc as a collapsible block, not always-expanded", () => {
    render(
      <DecisionCard
        question="q"
        payload={{ contractVersion: "decision-request/v1", answerShape: "approve", question: "q" }}
        sourceDoc="Very long source content that should be collapsed by default."
        onAnswer={vi.fn()}
      />,
    );

    const details = screen.getByTestId("source-doc");
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(details).not.toHaveAttribute("open");
  });

  it("resolves the primary control to match the AnswerShape — choose_one renders option cards, never a lone 'Approve' button", () => {
    render(
      <DecisionCard
        question="Which DAG engine?"
        payload={{
          contractVersion: "decision-request/v1",
          answerShape: "choose_one",
          question: "Which DAG engine?",
          choices: ["React Flow", "tldraw"],
        }}
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "React Flow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tldraw" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("calls onAnswer with the operator's choice", () => {
    const onAnswer = vi.fn();
    render(
      <DecisionCard
        question="q"
        payload={{ contractVersion: "decision-request/v1", answerShape: "yes_no", question: "q" }}
        onAnswer={onAnswer}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /yes/i }));
    expect(onAnswer).toHaveBeenCalledWith("yes");
  });
});
