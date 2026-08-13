import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BacklogBrowser } from "./BacklogBrowser";

const ENTRIES = [
  { id: "kb-1", title: "Adopt React Flow", created_at: "2026-07-25T00:00:00Z" },
  { id: "kb-2", title: "OTEL telemetry backend", created_at: "2026-07-25T01:00:00Z" },
];

describe("BacklogBrowser", () => {
  it("lists all kb_entries, not just recently-decided ones", () => {
    render(<BacklogBrowser entries={ENTRIES} onSearch={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.getByText("Adopt React Flow")).toBeInTheDocument();
    expect(screen.getByText("OTEL telemetry backend")).toBeInTheDocument();
  });

  it("calls onSearch as the operator types a filter query", () => {
    const onSearch = vi.fn();
    render(<BacklogBrowser entries={ENTRIES} onSearch={onSearch} onSelect={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "React" } });

    expect(onSearch).toHaveBeenCalledWith("React");
  });

  it("calls onSelect with the entry id when clicked", () => {
    const onSelect = vi.fn();
    render(<BacklogBrowser entries={ENTRIES} onSearch={vi.fn()} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Adopt React Flow"));

    expect(onSelect).toHaveBeenCalledWith("kb-1");
  });

  it("falls back to the plain ungrouped view when onSelectCollection is not supplied", () => {
    render(<BacklogBrowser entries={ENTRIES} onSearch={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("Adopt React Flow")).toBeInTheDocument();
  });
});

describe("BacklogBrowser — collection tabs (kb-01)", () => {
  it("renders a tab per known collection plus an All tab", () => {
    render(
      <BacklogBrowser entries={ENTRIES} onSearch={vi.fn()} onSelect={vi.fn()} onSelectCollection={vi.fn()} />,
    );

    expect(screen.getByRole("tab", { name: /all/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /general/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /marketing/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /boundary decisions/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /plans/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /artifacts/i })).toBeInTheDocument();
  });

  it("marks the active collection tab as selected, defaulting to All", () => {
    render(
      <BacklogBrowser entries={ENTRIES} onSearch={vi.fn()} onSelect={vi.fn()} onSelectCollection={vi.fn()} />,
    );

    expect(screen.getByRole("tab", { name: /all/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /general/i })).toHaveAttribute("aria-selected", "false");
  });

  it("reflects the activeCollection prop as the selected tab", () => {
    render(
      <BacklogBrowser
        entries={ENTRIES}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        onSelectCollection={vi.fn()}
        activeCollection="marketing"
      />,
    );

    expect(screen.getByRole("tab", { name: /marketing/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /all/i })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelectCollection with the collection id when a tab is clicked, and null for All", () => {
    const onSelectCollection = vi.fn();
    render(
      <BacklogBrowser
        entries={ENTRIES}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        onSelectCollection={onSelectCollection}
        activeCollection="marketing"
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /plans/i }));
    expect(onSelectCollection).toHaveBeenCalledWith("plans");

    fireEvent.click(screen.getByRole("tab", { name: /all/i }));
    expect(onSelectCollection).toHaveBeenCalledWith(null);
  });
});
