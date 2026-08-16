import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocSearch, type DocSearchResult } from "./DocSearch";

const PATH_MATCH: DocSearchResult = {
  repo: "consus",
  file_path: ".pHive/planning/prd.md",
  epic: null,
  phase: "planning",
  matched: ["path"],
  content_hash: "abc",
  last_scanned_at: "2026-08-01T00:00:00Z",
};

const CONTENT_MATCH: DocSearchResult = {
  repo: "consus",
  file_path: "docs/unrelated-name.md",
  epic: null,
  phase: "docs",
  matched: ["content"],
  content_hash: "def",
  last_scanned_at: "2026-08-01T00:00:00Z",
};

const BOTH_MATCH: DocSearchResult = {
  repo: "consus",
  file_path: ".pHive/planning/architecture.md",
  epic: "sample-epic",
  phase: "planning",
  matched: ["path", "content"],
  content_hash: "ghi",
  last_scanned_at: "2026-08-01T00:00:00Z",
};

describe("DocSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces onSearch — one call per typing pause, not one per keystroke", () => {
    const onSearch = vi.fn();
    render(<DocSearch onSearch={onSearch} results={null} onOpen={vi.fn()} />);

    const input = screen.getByRole("searchbox", { name: /search docs/i });
    fireEvent.change(input, { target: { value: "a" } });
    vi.advanceTimersByTime(100);
    fireEvent.change(input, { target: { value: "ar" } });
    vi.advanceTimersByTime(100);
    fireEvent.change(input, { target: { value: "arc" } });

    // Not enough time has elapsed since the last keystroke for the debounce
    // to have fired yet.
    expect(onSearch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("arc");
  });

  it("calls onSearch('') once the box is cleared back to empty", () => {
    const onSearch = vi.fn();
    render(<DocSearch onSearch={onSearch} results={null} onOpen={vi.fn()} />);

    const input = screen.getByRole("searchbox", { name: /search docs/i });
    fireEvent.change(input, { target: { value: "arc" } });
    vi.advanceTimersByTime(300);
    onSearch.mockClear();

    fireEvent.change(input, { target: { value: "" } });
    vi.advanceTimersByTime(300);

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("");
  });

  it("fires onOpen with the result's repo and file_path when a row is clicked", () => {
    const onOpen = vi.fn();
    render(<DocSearch onSearch={vi.fn()} results={[PATH_MATCH]} onOpen={onOpen} />);

    fireEvent.click(screen.getByText(".pHive/planning/prd.md"));

    expect(onOpen).toHaveBeenCalledWith("consus", ".pHive/planning/prd.md");
  });

  it("shows a distinct badge for a content-only match vs a path match", () => {
    render(<DocSearch onSearch={vi.fn()} results={[PATH_MATCH, CONTENT_MATCH]} onOpen={vi.fn()} />);

    const pathRow = screen.getByText(".pHive/planning/prd.md").closest("button") as HTMLElement;
    const contentRow = screen.getByText("docs/unrelated-name.md").closest("button") as HTMLElement;

    expect(pathRow.querySelector(".doc-search__badge--path")).toBeInTheDocument();
    expect(pathRow.querySelector(".doc-search__badge--content")).not.toBeInTheDocument();

    expect(contentRow.querySelector(".doc-search__badge--content")).toBeInTheDocument();
    expect(contentRow.querySelector(".doc-search__badge--path")).not.toBeInTheDocument();

    // The two badge classes carry visually distinct styling hooks.
    const pathBadge = pathRow.querySelector(".doc-search__badge--path");
    const contentBadge = contentRow.querySelector(".doc-search__badge--content");
    expect(pathBadge?.className).not.toEqual(contentBadge?.className);
  });

  it("shows both badges for a result matched on both dimensions", () => {
    render(<DocSearch onSearch={vi.fn()} results={[BOTH_MATCH]} onOpen={vi.fn()} />);

    const row = screen.getByText(".pHive/planning/architecture.md").closest("button") as HTMLElement;
    expect(row.querySelector(".doc-search__badge--path")).toBeInTheDocument();
    expect(row.querySelector(".doc-search__badge--content")).toBeInTheDocument();
  });

  it("shows an empty-results message when searched with no matches", () => {
    render(<DocSearch onSearch={vi.fn()} results={[]} onOpen={vi.fn()} />);

    expect(screen.getByText(/no docs match/i)).toBeInTheDocument();
  });

  it("renders no results list or empty-message when results is null (no search performed yet)", () => {
    render(<DocSearch onSearch={vi.fn()} results={null} onOpen={vi.fn()} />);

    expect(screen.queryByText(/no docs match/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows a visible error message when passed one, without hiding the input", () => {
    render(<DocSearch onSearch={vi.fn()} results={null} onOpen={vi.fn()} error="HTTP 500" />);

    expect(screen.getByText(/search failed/i)).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /search docs/i })).toBeInTheDocument();
  });
});
