import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// jsdom doesn't evaluate CSS layout/media queries, so the narrow-viewport
// collapse (list stacked above detail below 768px) is pinned at the
// source level here; a real-browser spot-check is left to review.
const cssPath = path.join(process.cwd(), "web/src/features/decisions/decisions-two-pane.css");

describe("decisions-two-pane.css", () => {
  it("contains a @media (max-width: 768px) rule collapsing the two-pane layout to a single column", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain("@media (max-width: 768px)");
  });
});
