import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobalView } from "./GlobalView";

const KB_ENTRIES = [
  { id: "kb-1", title: "Adopt React Flow", source_repo: "consus", created_at: "2026-07-25T00:00:00Z" },
  { id: "kb-2", title: "OTEL telemetry backend", source_repo: "other-project", created_at: "2026-07-25T01:00:00Z" },
];

describe("GlobalView", () => {
  it("groups entries with a project-name heading per group, not a flat list", () => {
    render(<GlobalView entries={KB_ENTRIES} onSelect={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "consus" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "other-project" })).toBeInTheDocument();
    expect(screen.getByText("Adopt React Flow")).toBeInTheDocument();
    expect(screen.getByText("OTEL telemetry backend")).toBeInTheDocument();
  });
});
