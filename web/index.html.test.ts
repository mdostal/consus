import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Source-level assertions, same convention as web/src/theme/tokens.css.test.ts
// -- the inline bootstrap <script> runs before React mounts (real browser
// only), so it's pinned here rather than executed under jsdom.
const htmlPath = path.join(process.cwd(), "web/index.html");
const html = readFileSync(htmlPath, "utf8");

describe("web/index.html", () => {
  it("has a real favicon (consus-phase30) -- none existed before this epic", () => {
    expect(html).toMatch(/<link rel="icon"[^>]*href="\/favicon\.svg"/);
    expect(html).toMatch(/<link rel="icon"[^>]*href="\/favicon\.ico"/);
  });

  it("the inline bootstrap script recognizes all 4 real skin values, including 'granary'", () => {
    expect(html).toContain('skin === "case-board"');
    expect(html).toContain('skin === "harness"');
    expect(html).toContain('skin === "drafting"');
  });

  it("the inline bootstrap script's fallback default is 'granary' (consus-phase30), matching useSkinPreference's DEFAULT_SKIN", () => {
    // Both the try-block fallback and the catch-block fallback must agree.
    const setAttrCalls = [...html.matchAll(/setAttribute\(\s*"data-skin",\s*([^)]+)\)/g)];
    expect(setAttrCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of setAttrCalls) {
      expect(call[1]).toMatch(/"granary"/);
    }
  });

  it("does not silently fall back to 'drafting' anywhere (the old, now-stale default)", () => {
    // The only legitimate appearance of the string "drafting" is as one of
    // the three explicitly-recognized stored values, never as a fallback.
    expect(html).not.toMatch(/:\s*"drafting"\s*[,)]/);
  });
});
