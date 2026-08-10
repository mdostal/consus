import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuestionInbox } from "./QuestionInbox";
import * as questionsApi from "../../api/questions";
import type { Question } from "../../api/questions";

vi.mock("../../api/questions", async () => {
  const actual = await vi.importActual<typeof questionsApi>("../../api/questions");
  return { ...actual, fetchQuestions: vi.fn(), submitAnswer: vi.fn() };
});

const fetchQuestionsMock = vi.mocked(questionsApi.fetchQuestions);
const submitAnswerMock = vi.mocked(questionsApi.submitAnswer);

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-1",
    text: "Which DAG engine should we use?",
    agent_name: "auriga-build",
    created_at: "2026-08-10T03:44:04Z",
    status: "pending",
    ...overrides,
  };
}

describe("QuestionInbox", () => {
  beforeEach(() => {
    fetchQuestionsMock.mockReset();
    submitAnswerMock.mockReset();
  });

  it("Given pending questions exist, displays all of them with question text, agent name, and timestamp", async () => {
    const items = [
      makeQuestion({ id: "q-1", text: "Which DAG engine?" }),
      makeQuestion({ id: "q-2", text: "Ship v1 without KB backlog?" }),
    ];
    fetchQuestionsMock.mockResolvedValue(items);

    render(<QuestionInbox />);

    const list = await screen.findByTestId("question-inbox");
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Which DAG engine?")).toBeInTheDocument();
    expect(screen.getByText("Ship v1 without KB backlog?")).toBeInTheDocument();
  });

  it("Given the user answers a question, it disappears from the inbox once submitted", async () => {
    fetchQuestionsMock.mockResolvedValue([makeQuestion({ id: "q-1", text: "Which DAG engine?" })]);
    submitAnswerMock.mockResolvedValue(undefined);

    render(<QuestionInbox />);

    await screen.findByText("Which DAG engine?");

    fireEvent.change(screen.getByLabelText("Answer for Which DAG engine?"), { target: { value: "React Flow." } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(screen.getByTestId("question-inbox-empty")).toBeInTheDocument());
  });

  it("Given the API errors, displays a user-friendly error message instead of crashing", async () => {
    fetchQuestionsMock.mockRejectedValue(new Error("Failed to load questions: DB unavailable"));

    render(<QuestionInbox />);

    const error = await screen.findByTestId("question-inbox-error");
    expect(error).toHaveTextContent(/couldn't load questions/i);
  });

  it("Given no pending questions, shows the 'No pending questions' empty state", async () => {
    fetchQuestionsMock.mockResolvedValue([]);

    render(<QuestionInbox />);

    const empty = await screen.findByTestId("question-inbox-empty");
    expect(empty).toHaveTextContent("No pending questions");
  });
});
