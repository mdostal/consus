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

// consus-phase30 s4 — found live during the Granary visual QA pass: 7 of 8
// answer-shape renderers (every one except AnswerControl itself) had never
// had dedicated CSS since they first shipped (phase15/28/29), across EVERY
// skin, not just Granary. Most visibly broken: CbaTable's real <table>
// rendered as unstyled run-together text (no default UA table-cell spacing
// at all). Regression-tests the fix, one representative assertion per
// component's real class names (from each component's own .tsx source),
// not an exhaustive style audit.
describe("app.css — answer-shape renderers (consus-phase30 s4 regression)", () => {
  it("styles CbaTable's real <table> (the most visibly broken case — was completely unstyled)", () => {
    expect(css).toMatch(/\.cba-table__grid\s*\{[^}]*border-collapse:\s*collapse/);
    expect(css).toMatch(/\.cba-table__grid td\s*\{[^}]*border-bottom:/);
  });

  it("styles FeatureChecklist (badge + per-feature cards)", () => {
    expect(css).toMatch(/\.feature-checklist__badge\s*\{[^}]*background:/);
    expect(css).toMatch(/\.feature-checklist__feature\s*\{[^}]*border:/);
  });

  it("styles RatingScale, including the selected (aria-pressed) state", () => {
    expect(css).toMatch(/\.rating-scale__value\s*\{[^}]*border:/);
    expect(css).toContain('.rating-scale__value[aria-pressed="true"]');
  });

  it("styles RankingList's draggable rows and rank badge", () => {
    expect(css).toMatch(/\.ranking-list__item\s*\{[^}]*border:/);
    expect(css).toMatch(/\.ranking-list__item-rank\s*\{[^}]*border-radius:/);
  });

  it("styles FreeTextResponse's textarea", () => {
    expect(css).toMatch(/\.free-text-response textarea\s*\{[^}]*border:/);
  });

  it("styles ConceptSelection's card grid", () => {
    expect(css).toMatch(/\.concept-selection__concepts\s*\{[^}]*grid-template-columns:/);
    expect(css).toMatch(/\.concept-selection__concept\s*\{[^}]*border:/);
  });

  it("styles EditProposalView's diff lines using --consus-good/--consus-bad, not hardcoded colors", () => {
    expect(css).toMatch(/\.edit-proposal-view__line--added\s*\{[^}]*var\(--consus-good\)/);
    expect(css).toMatch(/\.edit-proposal-view__line--removed\s*\{[^}]*var\(--consus-bad\)/);
  });

  it("uses only --consus-* tokens in the new answer-shape block, no hardcoded hex literals (must theme correctly under all 4 skins, not just Granary)", () => {
    const start = css.indexOf("consus-phase30 s4");
    const end = css.indexOf("Comment thread (REQ-04)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

// consus-phase30 hotfix — found live: "buttons and things need to be
// updated" (operator feedback after the theme integration shipped).
// Buttons across the app had a static fill/border and cursor:pointer with
// no hover, press, or visible-keyboard-focus feedback at all. Fixed with a
// single base-layer rule (filter:brightness(), works regardless of which
// --consus-* color a given button actually uses) rather than a
// per-component selector list, so it applies under all 4 skins at once.
describe("app.css — global button interactive affordance (consus-phase30 hotfix)", () => {
  it("gives every non-disabled button hover and active/press feedback", () => {
    expect(css).toMatch(/button:not\(:disabled\):hover\s*\{[^}]*filter:\s*brightness\(/);
    expect(css).toMatch(/button:not\(:disabled\):active\s*\{[^}]*filter:\s*brightness\(/);
  });

  it("gives keyboard focus a visible outline, distinct from mouse hover/click", () => {
    expect(css).toMatch(/button:focus-visible\s*\{[^}]*outline:[^}]*var\(--consus-accent\)/);
  });

  it("does not add a second @media (prefers-reduced-motion: reduce) block -- the button transition/press-transform override lives inside the one existing canonical block, so source-level tests that pin that block's contents (above) keep matching the right one", () => {
    // Matches only real rule openings (followed by "{"), not this file's own
    // prose comments that happen to mention the media-query name.
    const blocks = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{/g) ?? [];
    expect(blocks.length).toBe(1);
  });

  it("disables the button transition and press-transform under reduced motion, inside the one canonical block", () => {
    const mediaBlockMatch = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
    );
    const mediaBlock = mediaBlockMatch![1];
    expect(mediaBlock).toMatch(/button:not\(:disabled\)\s*\{[^}]*transition:\s*none/);
    expect(mediaBlock).toMatch(/button:not\(:disabled\):active\s*\{[^}]*transform:\s*none/);
  });
});
