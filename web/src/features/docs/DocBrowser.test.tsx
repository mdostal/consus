import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocBrowser } from "./DocBrowser";

const GROUPED = {
  delphi: {
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
    render(<DocBrowser grouped={GROUPED} onOpen={vi.fn()} />);

    expect(screen.getByText("delphi")).toBeInTheDocument();
    expect(screen.getByText("planning")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("sample-epic")).toBeInTheDocument();
    expect(screen.getByText(/prd\.md/)).toBeInTheDocument();
    expect(screen.getByText(/architecture\.md/)).toBeInTheDocument();
  });

  it("calls onOpen with the doc's repo and file_path when clicked", () => {
    const onOpen = vi.fn();
    render(<DocBrowser grouped={GROUPED} onOpen={onOpen} />);

    fireEvent.click(screen.getByText(/prd\.md/));

    expect(onOpen).toHaveBeenCalledWith("delphi", ".pHive/planning/prd.md");
  });
});
