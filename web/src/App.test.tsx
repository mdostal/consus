import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ThemeProvider } from "./components/ThemeProvider";

describe("App routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("renders the question inbox at /questions", async () => {
    window.history.pushState({}, "", "/questions");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: "question-1",
          agent_name: "Minerva",
          context: "PAN-100",
          question: "Should Consus ship the inbox?",
          created_at: "2026-08-10T03:00:00.000Z",
        },
      ],
    });

    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Question Inbox" })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/questions");
  });
});
