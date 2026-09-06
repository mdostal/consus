import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisualDiff, parseLineDiff, type VisualDiffEntry } from "./VisualDiff";
import { computeLineDiff } from "../docs/textDiff";

describe("VisualDiff", () => {
  it("shows an explicit empty state when there are no entries — never a blank/broken render", () => {
    render(<VisualDiff entries={[]} />);
    expect(screen.getByTestId("visual-diff-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("visual-diff")).not.toBeInTheDocument();
  });

  it("honors a custom empty message", () => {
    render(<VisualDiff entries={[]} emptyMessage="Nothing changed here." />);
    expect(screen.getByTestId("visual-diff-empty")).toHaveTextContent("Nothing changed here.");
  });

  it("renders one row per entry, typed by kind", () => {
    const entries: VisualDiffEntry[] = [
      { id: "1", kind: "add", label: "+ line" },
      { id: "2", kind: "remove", label: "- line" },
      { id: "3", kind: "change", label: "node Story One", detail: "label changed" },
      { id: "4", kind: "move", label: "node Story One", detail: "moved to (10, 20)" },
      { id: "5", kind: "context", label: "unchanged line" },
    ];
    render(<VisualDiff entries={entries} />);

    expect(screen.getByTestId("visual-diff-row-add")).toHaveTextContent("+ line");
    expect(screen.getByTestId("visual-diff-row-remove")).toHaveTextContent("- line");
    expect(screen.getByTestId("visual-diff-row-change")).toHaveTextContent("label changed");
    expect(screen.getByTestId("visual-diff-row-move")).toHaveTextContent("moved to (10, 20)");
    expect(screen.getByTestId("visual-diff-row-context")).toHaveTextContent("unchanged line");
  });

  it("gives each kind a distinct CSS modifier class", () => {
    const entries: VisualDiffEntry[] = [
      { id: "1", kind: "add", label: "a" },
      { id: "2", kind: "remove", label: "b" },
    ];
    render(<VisualDiff entries={entries} />);

    const addRow = screen.getByTestId("visual-diff-row-add");
    const removeRow = screen.getByTestId("visual-diff-row-remove");
    expect(addRow.className).toContain("visual-diff__row--add");
    expect(removeRow.className).toContain("visual-diff__row--remove");
    expect(addRow.className).not.toBe(removeRow.className);
  });
});

describe("parseLineDiff", () => {
  it("returns an empty array for an empty diff string", () => {
    expect(parseLineDiff("")).toEqual([]);
  });

  it("parses computeLineDiff's own output into add/remove/context entries", () => {
    const diff = computeLineDiff("# Original content", "# Original content\nExtra line added");
    const entries = parseLineDiff(diff);

    expect(entries).toEqual([
      { id: "line-0", kind: "context", label: "# Original content" },
      { id: "line-1", kind: "add", label: "Extra line added" },
    ]);
  });

  it("marks every line removed when the edited text is empty", () => {
    const diff = computeLineDiff("line one\nline two", "");
    const entries = parseLineDiff(diff);
    expect(entries.every((e) => e.kind === "remove" || e.label === "")).toBe(true);
  });

  it("renders visibly through VisualDiff end to end for a real doc edit", () => {
    const diff = computeLineDiff("line a", "line a\nline b");
    render(<VisualDiff entries={parseLineDiff(diff)} />);

    expect(screen.getByTestId("visual-diff-row-context")).toHaveTextContent("line a");
    expect(screen.getByTestId("visual-diff-row-add")).toHaveTextContent("line b");
  });
});
