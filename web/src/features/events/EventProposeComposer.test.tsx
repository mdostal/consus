import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventProposeComposer } from "./EventProposeComposer";
import type { EventRow } from "./EventsList";

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
    composed_prompt: "the doc changed, review it",
    status: "new",
    detected_at: "2026-08-01T00:00:00Z",
    status_updated_at: "2026-08-01T00:00:00Z",
    archived_at: null,
    proposal_id: null,
    ...overrides,
  };
}

describe("EventProposeComposer", () => {
  it("shows the event's stored diff read-only, with source_repo/source_path as a header", () => {
    render(<EventProposeComposer event={makeEvent()} onCancel={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByTestId("event-diff")).toHaveTextContent("line one");
    expect(screen.getByTestId("event-diff")).toHaveTextContent("line two");
    expect(screen.getByText(/consus.*docs\/architecture\.md/)).toBeInTheDocument();
  });

  it("shows the event's composed_prompt for extra context when present", () => {
    render(<EventProposeComposer event={makeEvent()} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText("the doc changed, review it")).toBeInTheDocument();
  });

  it("opens with an empty, required description field and the Propose button disabled", () => {
    render(<EventProposeComposer event={makeEvent()} onCancel={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: /description/i })).toHaveValue("");
    expect(screen.getByRole("button", { name: /^propose$/i })).toBeDisabled();
  });

  it("enables Propose once a description is entered", () => {
    render(<EventProposeComposer event={makeEvent()} onCancel={vi.fn()} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /description/i }), {
      target: { value: "please review this" },
    });

    expect(screen.getByRole("button", { name: /^propose$/i })).not.toBeDisabled();
  });

  it("calls onSubmit with the entered description when Propose is clicked", () => {
    const onSubmit = vi.fn();
    render(<EventProposeComposer event={makeEvent()} onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole("textbox", { name: /description/i }), {
      target: { value: "  please review this  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    expect(onSubmit).toHaveBeenCalledWith("please review this");
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<EventProposeComposer event={makeEvent()} onCancel={onCancel} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onCancel).toHaveBeenCalled();
  });

  it("shows a visible error message when provided, without hiding the composer", () => {
    render(<EventProposeComposer event={makeEvent()} onCancel={vi.fn()} onSubmit={vi.fn()} error="HTTP 500" />);

    expect(screen.getByText("HTTP 500")).toBeInTheDocument();
    expect(screen.getByTestId("event-diff")).toBeInTheDocument();
  });
});
