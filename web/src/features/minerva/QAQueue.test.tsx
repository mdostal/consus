import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QAQueue } from "./QAQueue";

const QUESTIONS = [
  {
    minervaQuestionId: "q-1",
    text: "Ship v1 with the flex-scope KB backlog cut?",
    ticketId: "DOS-1",
    decisionPayload: { contractVersion: "decision-request/v1" as const, answerShape: "yes_no" as const, question: "Ship v1 with the flex-scope KB backlog cut?" },
  },
  {
    minervaQuestionId: "q-2",
    text: "Channel-only escalation, no ticket",
    ticketId: null,
    decisionPayload: { contractVersion: "decision-request/v1" as const, answerShape: "yes_no" as const, question: "Channel-only escalation, no ticket" },
  },
];

describe("QAQueue", () => {
  it("shows a queue of unanswered questions, each linked to its originating ticket", () => {
    render(<QAQueue questions={QUESTIONS} onAnswer={vi.fn()} />);

    expect(screen.getByText(/Ship v1 with the flex-scope KB backlog cut\?/)).toBeInTheDocument();
    expect(screen.getByText("DOS-1")).toBeInTheDocument();
  });

  it("still shows a ticketless (channel-only) question in the queue rather than requiring a ticket to exist", () => {
    render(<QAQueue questions={QUESTIONS} onAnswer={vi.fn()} />);

    expect(screen.getByText(/Channel-only escalation, no ticket/)).toBeInTheDocument();
  });

  it("renders each question through the shared DecisionCard (yes/no buttons), not a bespoke form", () => {
    render(<QAQueue questions={[QUESTIONS[0]]} onAnswer={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^yes$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^no$/i })).toBeInTheDocument();
  });

  it("calls onAnswer with the question id and the operator's answer", () => {
    const onAnswer = vi.fn();
    render(<QAQueue questions={[QUESTIONS[0]]} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: /^yes$/i }));

    expect(onAnswer).toHaveBeenCalledWith("q-1", "yes");
  });
});
