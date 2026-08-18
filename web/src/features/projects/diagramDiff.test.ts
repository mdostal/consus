import { describe, it, expect } from "vitest";
import { createDiagramChange, formatDiagramDiff, type DiagramChange } from "./diagramDiff";

describe("createDiagramChange", () => {
  it("mints a unique id for every call, even for otherwise-identical input", () => {
    const input = { kind: "added" as const, entity: "node" as const, entityId: "n1", label: "New node" };
    const a = createDiagramChange(input);
    const b = createDiagramChange(input);
    expect(a.id).not.toBe(b.id);
  });
});

describe("formatDiagramDiff", () => {
  it("returns an empty string for zero changes", () => {
    expect(formatDiagramDiff([])).toBe("");
  });

  it("formats an added node/edge with a + prefix", () => {
    const changes: DiagramChange[] = [
      { id: "1", kind: "added", entity: "node", entityId: "n3", label: "Story Three" },
      { id: "2", kind: "added", entity: "edge", entityId: "e1", label: "Story One -> Story Three" },
    ];
    const diff = formatDiagramDiff(changes);
    expect(diff).toContain("+ node Story Three");
    expect(diff).toContain("+ edge Story One -> Story Three");
  });

  it("formats a removed edge with a - prefix", () => {
    const changes: DiagramChange[] = [
      { id: "1", kind: "removed", entity: "edge", entityId: "e2", label: "Story One -> Story Two" },
    ];
    expect(formatDiagramDiff(changes)).toBe("- edge Story One -> Story Two");
  });

  it("formats a changed label with a ~ prefix and the before/after detail", () => {
    const changes: DiagramChange[] = [
      {
        id: "1",
        kind: "changed",
        entity: "node",
        entityId: "n1",
        label: "Story One",
        detail: 'label changed from "Story One" to "Story 1"',
      },
    ];
    const diff = formatDiagramDiff(changes);
    expect(diff).toContain("~ node Story One:");
    expect(diff).toContain('label changed from "Story One" to "Story 1"');
  });

  it("formats a moved node distinctly from changed/added/removed (its own prefix)", () => {
    const changes: DiagramChange[] = [
      { id: "1", kind: "moved", entity: "node", entityId: "n1", label: "Story One", detail: "moved to (120, 340)" },
    ];
    const diff = formatDiagramDiff(changes);
    expect(diff).toContain("^ node Story One: moved to (120, 340)");
    expect(diff).not.toMatch(/^[+\-~] node Story One/);
  });

  it("keeps every change on its own line, in accumulation order", () => {
    const changes: DiagramChange[] = [
      { id: "1", kind: "added", entity: "node", entityId: "n1", label: "A" },
      { id: "2", kind: "moved", entity: "node", entityId: "n1", label: "A", detail: "moved to (10, 10)" },
      { id: "3", kind: "removed", entity: "edge", entityId: "e1", label: "A -> B" },
    ];
    const lines = formatDiagramDiff(changes).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\+/);
    expect(lines[1]).toMatch(/^\^/);
    expect(lines[2]).toMatch(/^-/);
  });
});
