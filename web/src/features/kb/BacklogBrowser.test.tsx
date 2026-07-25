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
});
