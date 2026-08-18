import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// jsdom doesn't evaluate real CSS animation/media-query behavior, so the
// Harness skin's terminal cursor blink reduced-motion override is pinned at
// the source level here — same convention as
// web/src/theme/tokens.css.test.ts and
// web/src/features/decisions/decisions-two-pane.css.test.ts.
const cssPath = path.join(process.cwd(), "web/src/app.css");
const css = readFileSync(cssPath, "utf8");

describe("app.css", () => {
  it("defines the Harness cursor blink animation unconditionally by default", () => {
    expect(css).toContain(
      'animation: harness-cursor-blink 1s steps(1, jump-none) infinite;'
    );
  });

  it("contains a @media (prefers-reduced-motion: reduce) block", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("overrides the Harness cursor's animation to a static (non-animated) state under reduced motion, without hiding the cursor element", () => {
    const mediaBlockMatch = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
    );
    expect(mediaBlockMatch).not.toBeNull();
    const mediaBlock = mediaBlockMatch![1];

    // Targets the same selector the base blink rule uses for the Harness cursor.
    expect(mediaBlock).toContain('[data-skin="harness"] .consus__brand-sub::after');
    // Disables the animation...
    expect(mediaBlock).toMatch(/\[data-skin="harness"\] \.consus__brand-sub::after\s*\{[^}]*animation:\s*none/);
    // ...but must not hide the cursor element entirely (still a visible, static indicator).
    expect(mediaBlock).not.toMatch(/display:\s*none/);
    expect(mediaBlock).not.toMatch(/visibility:\s*hidden/);
  });

  it("does not touch the two unrelated 0.12s color/border-fade transitions elsewhere in the codebase", () => {
    const mediaBlockMatch = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
    );
    const mediaBlock = mediaBlockMatch![1];
    expect(mediaBlock).not.toContain("0.12s");
  });
});
