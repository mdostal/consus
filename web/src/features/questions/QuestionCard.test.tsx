import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuestionCard } from "./QuestionCard";
import * as questionsApi from "../../api/questions";
import type { Question } from "../../api/questions";

vi.mock("../../api/questions", async () => {
  const actual = await vi.importActual<typeof questionsApi>("../../api/questions");
  return { ...actual, submitAnswer: vi.fn() };
});

const submitAnswerMock = vi.mocked(questionsApi.submitAnswer);

const QUESTION: Question = {
  id: "q-1",
  text: "Which DAG engine should we use?",
  agent_name: "auriga-build",
  created_at: "2026-08-10T03:44:04Z",
  status: "pending",
};

describe("QuestionCard", () => {
  beforeEach(() => {
    submitAnswerMock.mockReset();
  });

  it("Given a pending question, displays the question text, agent name, and timestamp", () => {
    render(<QuestionCard question={QUESTION} onAnswered={vi.fn()} />);

    expect(screen.getByText(QUESTION.text)).toBeInTheDocument();
    expect(screen.getByText(QUESTION.agent_name)).toBeInTheDocument();
    expect(screen.getByText(QUESTION.created_at)).toBeInTheDocument();
  });

  it("Given the user types an answer and clicks Submit, POSTs the answer and calls onAnswered", async () => {
    submitAnswerMock.mockResolvedValue(undefined);
    const onAnswered = vi.fn();

    render(<QuestionCard question={QUESTION} onAnswered={onAnswered} />);

    fireEvent.change(screen.getByLabelText(`Answer for ${QUESTION.text}`), { target: { value: "Use React Flow." } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(onAnswered).toHaveBeenCalledWith("q-1"));
    expect(submitAnswerMock).toHaveBeenCalledWith("q-1", { answer: "Use React Flow.", actor: "operator" });
  });

  it("Given the answer submission fails, displays an error message and keeps the answer in the textarea", async () => {
    submitAnswerMock.mockRejectedValue(new Error("Failed to submit answer: already answered"));
    const onAnswered = vi.fn();

    render(<QuestionCard question={QUESTION} onAnswered={onAnswered} />);

    const textarea = screen.getByLabelText(`Answer for ${QUESTION.text}`);
    fireEvent.change(textarea, { target: { value: "Use React Flow." } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/already answered/);
    expect(textarea).toHaveValue("Use React Flow.");
    expect(onAnswered).not.toHaveBeenCalled();
  });

  it("disables Submit until the answer textarea has non-whitespace content", () => {
    render(<QuestionCard question={QUESTION} onAnswered={vi.fn()} />);

    const submit = screen.getByRole("button", { name: /submit/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(`Answer for ${QUESTION.text}`), { target: { value: "   " } });
    expect(submit).toBeDisabled();
  });
});
