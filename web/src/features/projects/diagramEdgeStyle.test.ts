import { describe, it, expect, afterEach } from "vitest";
import { resolveEdgeStyle, buildEdgePath } from "./diagramEdgeStyle";

describe("resolveEdgeStyle", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--consus-edge-style");
  });

  it("defaults to straight when the token is unset", () => {
    expect(resolveEdgeStyle()).toBe("straight");
  });

  it("resolves organic for Case Board's token value", () => {
    document.documentElement.style.setProperty("--consus-edge-style", "organic");
    expect(resolveEdgeStyle()).toBe("organic");
  });

  it("resolves straight for Drafting Table / Harness's token value", () => {
    document.documentElement.style.setProperty("--consus-edge-style", "straight");
    expect(resolveEdgeStyle()).toBe("straight");
  });

  it("falls back to straight for an unrecognized token value rather than throwing", () => {
    document.documentElement.style.setProperty("--consus-edge-style", "bogus");
    expect(resolveEdgeStyle()).toBe("straight");
  });
});

describe("buildEdgePath", () => {
  it("draws organic edges with a quadratic curve command, distinct from straight", () => {
    const organic = buildEdgePath(0, 0, 200, 100, "organic");
    expect(organic.path).toContain("Q");
  });

  it("draws straight/orthogonal edges with only line commands, no curve command", () => {
    const straight = buildEdgePath(0, 0, 200, 100, "straight");
    expect(straight.path).not.toContain("Q");
    expect(straight.path).not.toContain("C");
    expect(straight.path).toContain("L");
  });

  it("produces a materially different path string between the two styles for the same endpoints", () => {
    const organic = buildEdgePath(10, 20, 300, 220, "organic");
    const straight = buildEdgePath(10, 20, 300, 220, "straight");
    expect(organic.path).not.toBe(straight.path);
  });

  it("keeps the organic sag bounded rather than exploding for very long edges", () => {
    const organic = buildEdgePath(0, 0, 5000, 0, "organic");
    const straightMidY = 0;
    // control point (labelY) should be offset from the straight midpoint,
    // but not wildly so
    expect(organic.labelY).toBeGreaterThan(straightMidY);
    expect(organic.labelY).toBeLessThanOrEqual(straightMidY + 60);
  });
});
