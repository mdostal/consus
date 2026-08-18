import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// jsdom doesn't evaluate real CSS cascade/media-query resolution, so the
// three-state theme pattern (explicit [data-theme] choice beats OS default,
// in both directions) and the independent [data-skin] axis are pinned at
// the source level here — same convention as
// web/src/features/decisions/decisions-two-pane.css.test.ts (consus-phase16).
const cssPath = path.join(process.cwd(), "web/src/theme/tokens.css");
const css = readFileSync(cssPath, "utf8");

const SKINS = ["drafting", "case-board", "harness"];

describe("tokens.css", () => {
  it("defines the light palette tokens on a bare :root", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--consus-bg:/);
    expect(css).toMatch(/:root\s*\{[^}]*--consus-ink:/);
  });

  it("guards the prefers-color-scheme dark override with :not([data-theme=\"light\"]), so an explicit light choice beats a dark OS default", () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:not([data-theme="light"])');
  });

  it("defines an explicit [data-theme=\"dark\"] override, so an explicit dark choice beats a light OS default", () => {
    expect(css).toContain('[data-theme="dark"]');
  });

  it("does not gate the explicit [data-theme=\"dark\"] override behind prefers-color-scheme (must win regardless of OS setting)", () => {
    // The un-guarded root dark rule ":root[data-theme=\"dark\"]" must exist
    // outside of any @media block requirement — i.e. as its own top-level rule.
    expect(css).toMatch(/^:root\[data-theme="dark"\]\s*\{/m);
  });

  it("defines a [data-skin] axis, independent of theme, for all three skins", () => {
    for (const skin of SKINS) {
      expect(css).toContain(`[data-skin="${skin}"]`);
    }
  });

  it("gives each skin its own light palette (base [data-skin=\"...\"] selector, not just theme overrides)", () => {
    for (const skin of SKINS) {
      const re = new RegExp(`\\[data-skin="${skin}"\\]\\s*\\{[^}]*--consus-bg:`);
      expect(css).toMatch(re);
    }
  });

  it("gives each skin its own dark palette under the guarded prefers-color-scheme rule (skin stays orthogonal to theme)", () => {
    for (const skin of SKINS) {
      const re = new RegExp(`\\[data-skin="${skin}"\\]:not\\(\\[data-theme="light"\\]\\)\\s*\\{[^}]*--consus-bg:`);
      expect(css).toMatch(re);
    }
  });

  it("gives each skin its own explicit dark override under [data-theme=\"dark\"] (explicit choice wins for every skin, not just the default)", () => {
    for (const skin of SKINS) {
      const re = new RegExp(`\\[data-skin="${skin}"\\]\\[data-theme="dark"\\]\\s*\\{[^}]*--consus-bg:`);
      expect(css).toMatch(re);
    }
  });

  it("carries a type-stack (font) token per skin, not just color, so skins can look structurally distinct", () => {
    for (const skin of SKINS) {
      const re = new RegExp(`\\[data-skin="${skin}"\\]\\s*\\{[^}]*--consus-font-`);
      expect(css).toMatch(re);
    }
  });
});
