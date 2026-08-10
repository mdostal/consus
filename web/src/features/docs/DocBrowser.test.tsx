import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DocBrowser } from "./DocBrowser";

const GROUPED = {
  consus: {
    planning: [
      { epic: null, file_path: ".pHive/planning/prd.md", content_hash: "abc", last_scanned_at: "2026-07-25T00:00:00Z" },
    ],
    docs: [
      { epic: "sample-epic", file_path: ".pHive/epics/sample-epic/docs/architecture.md", content_hash: "def", last_scanned_at: "2026-07-25T00:00:00Z" },
    ],
  },
};

describe("DocBrowser", () => {
  it("lists docs grouped by repo, then epic, then phase", () => {
    render(
      <MemoryRouter>
        <DocBrowser grouped={GROUPED} onOpen={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.getByText("consus")).toBeInTheDocument();
    expect(screen.getByText("planning")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("sample-epic")).toBeInTheDocument();
    expect(screen.getByText(/prd\.md/)).toBeInTheDocument();
    expect(screen.getByText(/architecture\.md/)).toBeInTheDocument();
  });

  it("calls onOpen with the doc's repo and file_path when clicked", () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter>
        <DocBrowser grouped={GROUPED} onOpen={onOpen} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText(/prd\.md/));

    expect(onOpen).toHaveBeenCalledWith("consus", ".pHive/planning/prd.md");
  });
});
