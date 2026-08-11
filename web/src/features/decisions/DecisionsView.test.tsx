import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DecisionsView } from "./DecisionsView";
import * as decisionsApi from "../../api/decisions";
import type { DecisionListItem } from "../../api/decisions";

vi.mock("../../api/decisions", async () => {
  const actual = await vi.importActual<typeof decisionsApi>("../../api/decisions");
  return { ...actual, fetchDecisions: vi.fn() };
});

const fetchDecisionsMock = vi.mocked(decisionsApi.fetchDecisions);

function makeItem(overrides: Partial<DecisionListItem> = {}): DecisionListItem {
  return {
    id: "multica:mul-1",
    type: "multica_issue",
    title: "Choose the layout",
    status: "in_review",
    decision_payload: null,
    decision_type: "choose",
    triage_bucket: "open_question",
    ...overrides,
  };
}

describe("DecisionsView", () => {
  beforeEach(() => {
    fetchDecisionsMock.mockReset();
  });

  it("renders a list pane and a detail pane, with the detail pane empty until a row is selected", async () => {
    fetchDecisionsMock.mockResolvedValue([makeItem()]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <DecisionsView />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("decisions-view-list-pane")).toBeInTheDocument();
    expect(screen.getByTestId("decisions-view-detail-pane")).toBeInTheDocument();
    expect(screen.getByTestId("decision-detail-empty")).toBeInTheDocument();
  });

  it("Given a decision selected in the list, when a different decision is clicked, then the detail panel updates without the list panel losing its items", async () => {
    fetchDecisionsMock.mockResolvedValue([
      makeItem({ id: "multica:mul-1", title: "Choose the layout" }),
      makeItem({ id: "multica:mul-2", title: "Pick the database" }),
    ]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <DecisionsView />
      </MemoryRouter>,
    );

    const list = await screen.findByTestId("decision-list");
    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(2);

    fireEvent.click(screen.getByText("Choose the layout"));
    expect(await screen.findByTestId("decision-detail")).toHaveTextContent("Choose the layout");
    expect(list.querySelectorAll("li")).toHaveLength(2);

    fireEvent.click(screen.getByText("Pick the database"));
    await waitFor(() => expect(screen.getByTestId("decision-detail")).toHaveTextContent("Pick the database"));
    expect(list.querySelectorAll("li")).toHaveLength(2);
  });

  it("marks the selected row as selected via aria-selected", async () => {
    fetchDecisionsMock.mockResolvedValue([
      makeItem({ id: "multica:mul-1", title: "Choose the layout" }),
      makeItem({ id: "multica:mul-2", title: "Pick the database" }),
    ]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <DecisionsView />
      </MemoryRouter>,
    );

    await screen.findByTestId("decision-list");
    fireEvent.click(screen.getByText("Choose the layout"));

    const options = await screen.findAllByRole("option");
    await waitFor(() => expect(options[0]).toHaveAttribute("aria-selected", "true"));
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("Given the API errors, displays a user-friendly error message in the list pane", async () => {
    fetchDecisionsMock.mockRejectedValue(new Error("Failed to load decisions: Multica fetch failed: timeout"));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <DecisionsView />
      </MemoryRouter>,
    );

    const error = await screen.findByTestId("decision-list-error");
    expect(error).toHaveTextContent(/couldn't load decisions/i);
  });
});
