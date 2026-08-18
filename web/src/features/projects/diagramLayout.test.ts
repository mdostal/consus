import { describe, it, expect } from "vitest";
import { estimateNodeWidth, layoutByLevel, boxesOverlap, computeLevelsFromEdges, type LayoutNodeInput } from "./diagramLayout";

describe("estimateNodeWidth", () => {
  it("grows with label length instead of using one fixed slot size", () => {
    const short = estimateNodeWidth("A");
    const long = estimateNodeWidth("A much longer story title than the others");
    expect(long).toBeGreaterThan(short);
  });

  it("never returns a width below a sane minimum, even for an empty label", () => {
    expect(estimateNodeWidth("")).toBeGreaterThan(0);
  });
});

describe("layoutByLevel — 6+ sibling regression guard", () => {
  // The exact style of labels called out in design-discussion.md's real bug
  // report ("server/decision-contra", "server/li" truncated/overlapping).
  const siblings: LayoutNodeInput[] = [
    { id: "n1", label: "server/decision-contra", level: 1 },
    { id: "n2", label: "server/li", level: 1 },
    { id: "n3", label: "server/harness/transport", level: 1 },
    { id: "n4", label: "server/routes/proposals", level: 1 },
    { id: "n5", label: "server/routes/diagrams", level: 1 },
    { id: "n6", label: "server/lib/diagram-generator", level: 1 },
    { id: "n7", label: "web/src/features/projects", level: 1 },
    { id: "n8", label: "web/src/theme", level: 1 },
  ];

  it("lays out 8 sibling nodes with zero pairwise overlap", () => {
    const positions = layoutByLevel(siblings);
    expect(positions.size).toBe(siblings.length);

    const positioned = siblings.map((n) => positions.get(n.id)!);
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        expect(boxesOverlap(positioned[i], positioned[j])).toBe(false);
      }
    }
  });

  it("gives every sibling a strictly non-decreasing x with a real gap from its left neighbor", () => {
    const positions = layoutByLevel(siblings);
    const ordered = siblings.map((n) => positions.get(n.id)!);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const curr = ordered[i];
      expect(curr.x).toBeGreaterThanOrEqual(prev.x + prev.width);
    }
  });

  it("sizes each node wide enough that its own full label isn't the thing causing an overlap", () => {
    const positions = layoutByLevel(siblings);
    for (const n of siblings) {
      const pos = positions.get(n.id)!;
      expect(pos.width).toBeGreaterThanOrEqual(estimateNodeWidth(n.label));
    }
  });

  it("still holds at a larger fan-out (12 siblings)", () => {
    const many: LayoutNodeInput[] = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      label: `component-with-a-fairly-long-name-${i}`,
      level: 0,
    }));
    const positions = layoutByLevel(many);
    const positioned = many.map((n) => positions.get(n.id)!);
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        expect(boxesOverlap(positioned[i], positioned[j])).toBe(false);
      }
    }
  });
});

describe("layoutByLevel — rows and grouping", () => {
  it("places different levels on different rows (never counted as overlapping)", () => {
    const nodes: LayoutNodeInput[] = [
      { id: "parent", label: "Epic A", level: 0 },
      { id: "child", label: "Story One", level: 1 },
    ];
    const positions = layoutByLevel(nodes);
    expect(positions.get("parent")!.y).not.toBe(positions.get("child")!.y);
    expect(boxesOverlap(positions.get("parent")!, positions.get("child")!)).toBe(false);
  });

  it("orders same-level nodes by groupOrder before input order", () => {
    const nodes: LayoutNodeInput[] = [
      { id: "b", label: "B", level: 0, groupOrder: 1 },
      { id: "a", label: "A", level: 0, groupOrder: 0 },
    ];
    const positions = layoutByLevel(nodes);
    expect(positions.get("a")!.x).toBeLessThan(positions.get("b")!.x);
  });
});

describe("computeLevelsFromEdges", () => {
  it("assigns the root (no incoming edges) level 0 and children level 1", () => {
    const levels = computeLevelsFromEdges(
      ["root", "src", "server"],
      [
        { source: "root", target: "src" },
        { source: "root", target: "server" },
      ],
    );
    expect(levels.get("root")).toBe(0);
    expect(levels.get("src")).toBe(1);
    expect(levels.get("server")).toBe(1);
  });

  it("assigns deeper descendants increasing levels", () => {
    const levels = computeLevelsFromEdges(
      ["root", "src", "src_index"],
      [
        { source: "root", target: "src" },
        { source: "src", target: "src_index" },
      ],
    );
    expect(levels.get("src_index")).toBe(2);
  });

  it("uses the shallowest path when a node has multiple parents", () => {
    const levels = computeLevelsFromEdges(
      ["root", "a", "b", "shared"],
      [
        { source: "root", target: "a" },
        { source: "a", target: "b" },
        { source: "b", target: "shared" }, // depth 3 via this path
        { source: "root", target: "shared" }, // depth 1 via this path
      ],
    );
    expect(levels.get("shared")).toBe(1);
  });

  it("defaults an unreachable node to level 0 rather than throwing", () => {
    const levels = computeLevelsFromEdges(["root", "orphan"], [{ source: "root", target: "root" }]);
    expect(levels.get("orphan")).toBe(0);
  });
});
