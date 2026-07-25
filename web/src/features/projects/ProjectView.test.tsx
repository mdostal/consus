import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectView } from "./ProjectView";

describe("ProjectView", () => {
  it("shows only the given project's entries — no cross-project leakage", () => {
    render(
      <ProjectView
        project="consus"
        entries={[{ id: "kb-1", title: "Adopt React Flow", source_repo: "consus", created_at: "2026-07-25T00:00:00Z" }]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "consus" })).toBeInTheDocument();
    expect(screen.getByText("Adopt React Flow")).toBeInTheDocument();
    expect(screen.queryByText("OTEL telemetry backend")).not.toBeInTheDocument();
  });
});
