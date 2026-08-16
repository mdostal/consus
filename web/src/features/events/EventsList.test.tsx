import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventsList, type EventRow } from "./EventsList";

function makeEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "event-1",
    project: "consus",
    trigger_kind: "doc_changed",
    source_repo: "consus",
    source_path: "docs/architecture.md",
    content_hash: "abc",
    previous_hash: "old",
    diff: "  line one\n+ line two",
    item_id: null,
    composed_prompt: "review the doc change",
    status: "new",
    detected_at: "2026-08-01T00:00:00Z",
    status_updated_at: "2026-08-01T00:00:00Z",
    archived_at: null,
    proposal_id: null,
    ...overrides,
  };
}

describe("EventsList", () => {
  it("renders one row per event with project, trigger_kind, source path, detected_at, and status all visible", () => {
    render(<EventsList events={[makeEvent()]} viewMode="active" onStatusChange={vi.fn()} onPropose={vi.fn()} />);

    expect(screen.getByText("consus")).toBeInTheDocument();
    expect(screen.getByText("doc_changed")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.getByText("2026-08-01T00:00:00Z")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /status for docs\/architecture\.md/i })).toHaveValue("new");
  });

  it("exposes all four status values in the per-row status select", () => {
    render(<EventsList events={[makeEvent()]} viewMode="active" onStatusChange={vi.fn()} onPropose={vi.fn()} />);

    const select = screen.getByRole("combobox", { name: /status for/i });
    const optionValues = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(optionValues).toEqual(["new", "in_progress", "done", "dismissed"]);
  });

  it("calls onStatusChange with the event id and the newly selected status", () => {
    const onStatusChange = vi.fn();
    render(
      <EventsList events={[makeEvent()]} viewMode="active" onStatusChange={onStatusChange} onPropose={vi.fn()} />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: /status for/i }), { target: { value: "in_progress" } });

    expect(onStatusChange).toHaveBeenCalledWith("event-1", "in_progress");
  });

  it("shows a 'Propose a change' button for an event with a non-null diff and calls onPropose with that event", () => {
    const onPropose = vi.fn();
    const event = makeEvent();
    render(<EventsList events={[event]} viewMode="active" onStatusChange={vi.fn()} onPropose={onPropose} />);

    const button = screen.getByRole("button", { name: /propose a change/i });
    fireEvent.click(button);

    expect(onPropose).toHaveBeenCalledWith(event);
  });

  it("does not offer a 'Propose a change' action for a decision_needed event with a null diff", () => {
    render(
      <EventsList
        events={[makeEvent({ trigger_kind: "decision_needed", diff: null })]}
        viewMode="active"
        onStatusChange={vi.fn()}
        onPropose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /propose a change/i })).not.toBeInTheDocument();
  });

  it("shows a proposed indicator once the event has an associated proposal", () => {
    render(
      <EventsList
        events={[makeEvent({ proposal_id: "proposal-1" })]}
        viewMode="active"
        onStatusChange={vi.fn()}
        onPropose={vi.fn()}
      />,
    );

    expect(screen.getByText(/proposed/i)).toBeInTheDocument();
  });

  it("shows an active-view empty state when there are no events", () => {
    render(<EventsList events={[]} viewMode="active" onStatusChange={vi.fn()} onPropose={vi.fn()} />);
    expect(screen.getByText("No events yet")).toBeInTheDocument();
  });

  it("shows an archived-view empty state when there are no archived events", () => {
    render(<EventsList events={[]} viewMode="archived" onStatusChange={vi.fn()} onPropose={vi.fn()} />);
    expect(screen.getByText("No archived events")).toBeInTheDocument();
  });
});
