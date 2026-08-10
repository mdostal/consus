import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionsView } from "./QuestionsView";

const QUESTIONS = [
  {
    id: "question-1",
    agent_name: "Minerva",
    context: "PAN-100",
    question: "Should Consus ship the inbox?",
    created_at: "2026-08-10T03:00:00.000Z",
  },
  {
    id: "question-2",
    agent_name: "Auriga",
    context: null,
    question: "Which route should own parked questions?",
    created_at: "2026-08-10T03:10:00.000Z",
  },
];

function mockFetch(response: unknown, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    json: async () => response,
  });
}

describe("QuestionsView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state initially", () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<QuestionsView />);

    expect(screen.getByTestId("questions-loading")).toHaveTextContent("Loading questions...");
  });

  it("fetches questions on mount via GET /api/questions", async () => {
    mockFetch(QUESTIONS);

    render(<QuestionsView />);

    await screen.findByText("Should Consus ship the inbox?");
    expect(global.fetch).toHaveBeenCalledWith("/api/questions");
  });

  it("displays questions in a table with agent, context, and question columns", async () => {
    mockFetch(QUESTIONS);

    render(<QuestionsView />);

    expect(await screen.findByRole("columnheader", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Context" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Question" })).toBeInTheDocument();
    expect(screen.getByText("Minerva")).toBeInTheDocument();
    expect(screen.getByText("PAN-100")).toBeInTheDocument();
    expect(screen.getByText("Which route should own parked questions?")).toBeInTheDocument();
  });

  it("submits an answer to POST /api/questions/:id/answer", async () => {
    mockFetch(QUESTIONS);

    render(<QuestionsView />);

    const answer = await screen.findByLabelText("Answer Should Consus ship the inbox?");
    fireEvent.change(answer, { target: { value: "Ship it." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Submit" })[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/questions/question-1/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: "Ship it.", actor: "mathew" }),
      });
    });
  });

  it("removes a question from the list after successful answer", async () => {
    mockFetch(QUESTIONS);

    render(<QuestionsView />);

    const answer = await screen.findByLabelText("Answer Should Consus ship the inbox?");
    fireEvent.change(answer, { target: { value: "Ship it." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Submit" })[0]);

    await waitFor(() => {
      expect(screen.queryByText("Should Consus ship the inbox?")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Which route should own parked questions?")).toBeInTheDocument();
  });

  it("keeps a question visible if answer submission fails", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => QUESTIONS,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: "Multica unavailable" }),
      });

    render(<QuestionsView />);

    const answer = await screen.findByLabelText("Answer Should Consus ship the inbox?");
    fireEvent.change(answer, { target: { value: "Ship it." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Submit" })[0]);

    expect(await screen.findByText("Unable to submit answer")).toBeInTheDocument();
    expect(screen.getByText("Should Consus ship the inbox?")).toBeInTheDocument();
  });

  it("shows error state if fetch fails", async () => {
    mockFetch({ error: "Multica unavailable" }, false);

    render(<QuestionsView />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load questions");
  });

  it("shows empty state if no questions are open", async () => {
    mockFetch([]);

    render(<QuestionsView />);

    expect(await screen.findByTestId("questions-empty")).toHaveTextContent("No parked questions");
  });
});
