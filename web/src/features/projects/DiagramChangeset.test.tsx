import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiagramChangeset, DiagramDirtyDot, DiagramPendingCount } from "./DiagramChangeset";
import type { DiagramChange } from "./diagramDiff";

describe("DiagramChangeset", () => {
  it("shows an empty state with zero changes", () => {
    render(<DiagramChangeset changes={[]} />);
    expect(screen.getByText(/no pending changes yet/i)).toBeInTheDocument();
  });

  it("renders one row per change, typed by kind", () => {
    const changes: DiagramChange[] = [
      { id: "1", kind: "added", entity: "node", entityId: "n1", label: "Story Three" },
      { id: "2", kind: "removed", entity: "edge", entityId: "e1", label: "A -> B" },
      { id: "3", kind: "changed", entity: "node", entityId: "n1", label: "Story One", detail: "label changed" },
      { id: "4", kind: "moved", entity: "node", entityId: "n1", label: "Story One", detail: "moved to (10, 20)" },
    ];
    render(<DiagramChangeset changes={changes} />);

    expect(screen.getByTestId("changeset-row-added")).toHaveTextContent("Story Three");
    expect(screen.getByTestId("changeset-row-removed")).toHaveTextContent("A -> B");
    expect(screen.getByTestId("changeset-row-changed")).toHaveTextContent("label changed");
    expect(screen.getByTestId("changeset-row-moved")).toHaveTextContent("moved to (10, 20)");
  });

  it("gives 'moved' rows a distinct CSS modifier class from every other kind", () => {
    const changes: DiagramChange[] = [
      { id: "1", kind: "added", entity: "node", entityId: "n1", label: "X" },
      { id: "2", kind: "moved", entity: "node", entityId: "n1", label: "X", detail: "moved to (1, 2)" },
    ];
    render(<DiagramChangeset changes={changes} />);

    const addedRow = screen.getByTestId("changeset-row-added");
    const movedRow = screen.getByTestId("changeset-row-moved");
    expect(movedRow.className).toContain("diagram-changeset__row--moved");
    expect(movedRow.className).not.toBe(addedRow.className);
    expect(addedRow.className).not.toContain("--moved");
  });

  it("shows a running count in the title once there are changes", () => {
    render(
      <DiagramChangeset
        changes={[{ id: "1", kind: "added", entity: "node", entityId: "n1", label: "X" }]}
      />,
    );
    expect(screen.getByText("(1)")).toBeInTheDocument();
  });
});

describe("DiagramDirtyDot", () => {
  it("renders nothing when clean", () => {
    render(<DiagramDirtyDot dirty={false} label="Architecture" />);
    expect(screen.queryByTestId("diagram-dirty-dot")).not.toBeInTheDocument();
  });

  it("renders a visible indicator when dirty", () => {
    render(<DiagramDirtyDot dirty label="Architecture" />);
    expect(screen.getByTestId("diagram-dirty-dot")).toBeInTheDocument();
  });
});

describe("DiagramPendingCount", () => {
  it("renders the given total, singular for exactly one", () => {
    render(<DiagramPendingCount count={1} />);
    expect(screen.getByTestId("diagram-pending-count")).toHaveTextContent("1 pending change");
  });

  it("renders the given total, plural for zero or more than one", () => {
    render(<DiagramPendingCount count={3} />);
    expect(screen.getByTestId("diagram-pending-count")).toHaveTextContent("3 pending changes");
  });
});
