import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DecisionList } from "./DecisionList";
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

describe("DecisionList", () => {
  beforeEach(() => {
    fetchDecisionsMock.mockReset();
  });

  it("Given the API returns decisions, renders one card per decision", async () => {
    const items = Array.from({ length: 79 }, (_, i) => makeItem({ id: `multica:mul-${i}`, title: `Task ${i}` }));
    fetchDecisionsMock.mockResolvedValue(items);

    render(<DecisionList />);

    const list = await screen.findByTestId("decision-list");
    expect(list.querySelectorAll("li")).toHaveLength(79);
  });

  it("Given a decision classified as decision_type 'cba' (architecture), displays the architecture badge", async () => {
    fetchDecisionsMock.mockResolvedValue([makeItem({ decision_type: "cba", title: "Microservices vs. monolith" })]);

    render(<DecisionList />);

    expect(await screen.findByTestId("decision-type-badge")).toHaveTextContent("Architecture");
  });

  it("Given the API errors (503), displays a user-friendly error message instead of crashing", async () => {
    fetchDecisionsMock.mockRejectedValue(new Error("Failed to load decisions: Multica fetch failed: timeout"));

    render(<DecisionList />);

    const error = await screen.findByTestId("decision-list-error");
    expect(error).toHaveTextContent(/couldn't load decisions/i);
  });

  it("Given the API returns no open decisions, shows an empty state rather than a blank screen", async () => {
    fetchDecisionsMock.mockResolvedValue([]);

    render(<DecisionList />);

    await waitFor(() => expect(screen.getByTestId("decision-list-empty")).toBeInTheDocument());
  });

  it("Given items are passed directly, skips the fetch and renders them", async () => {
    render(<DecisionList items={[makeItem({ id: "multica:mul-9", title: "Controlled item" })]} />);

    expect(await screen.findByText("Controlled item")).toBeInTheDocument();
    expect(fetchDecisionsMock).not.toHaveBeenCalled();
  });

  it("Given an onSelect handler, clicking a row calls it with that row's item", async () => {
    const onSelect = vi.fn();
    render(<DecisionList items={[makeItem({ id: "multica:mul-1" }), makeItem({ id: "multica:mul-2" })]} onSelect={onSelect} />);

    const rows = await screen.findAllByRole("option");
    fireEvent.click(rows[1]);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "multica:mul-2" }));
  });

  it("Given a selectedId matching a row, marks that row aria-selected and leaves others unselected", async () => {
    render(
      <DecisionList
        items={[makeItem({ id: "multica:mul-1" }), makeItem({ id: "multica:mul-2" })]}
        selectedId="multica:mul-2"
        onSelect={vi.fn()}
      />,
    );

    const rows = await screen.findAllByRole("option");
    expect(rows[0]).toHaveAttribute("aria-selected", "false");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
  });
});
