import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MastheadMark } from "./BrandMark";

function setSkin(skin: string | null) {
  if (skin === null) document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", skin);
}

afterEach(() => {
  setSkin(null);
});

/**
 * MastheadMark (consus-phase30-brand-theme-integration, s2; corrected
 * same-day, consus-phase30 hotfix) — the real Monogram brand SVG (the
 * concept the operator actually selected via a real recorded verdict,
 * {"kind":"concept_selected","conceptId":"monogram"}) replaces the literal
 * "◈" placeholder ONLY when Granary is active (design-discussion.md's
 * resolved open question); the other 3 skins keep "◈" exactly as before
 * this epic.
 */
describe("MastheadMark", () => {
  it("renders the real Monogram SVG when the Granary skin is active", () => {
    setSkin("granary");
    render(<MastheadMark />);
    const svg = screen.getByRole("img", { name: "Consus" });
    expect(svg).toBeInTheDocument();
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(screen.queryByText("◈")).not.toBeInTheDocument();
  });

  it("renders the operator's actual selected concept (Monogram: an open C arc + kernel), not a different concept substituted by design judgment", () => {
    setSkin("granary");
    render(<MastheadMark />);
    const svg = screen.getByRole("img", { name: "Consus" });
    // Monogram's distinguishing feature vs. Abstract Mark: the open "C" arc
    // path (`A 48,48`), absent from Abstract Mark's geometry.
    expect(svg.innerHTML).toContain("A 48,48");
  });

  it("renders the literal '◈' placeholder, unchanged, for the drafting skin", () => {
    setSkin("drafting");
    render(<MastheadMark />);
    expect(screen.getByText("◈")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Consus" })).not.toBeInTheDocument();
  });

  it("renders the literal '◈' placeholder, unchanged, for the case-board skin", () => {
    setSkin("case-board");
    render(<MastheadMark />);
    expect(screen.getByText("◈")).toBeInTheDocument();
  });

  it("renders the literal '◈' placeholder, unchanged, for the harness skin", () => {
    setSkin("harness");
    render(<MastheadMark />);
    expect(screen.getByText("◈")).toBeInTheDocument();
  });

  it("uses live --consus-* tokens for its fills, not hardcoded brand hexes, so it stays legible in both light and dark Granary (regression: the static logo-concepts.yaml hex has only 1.4:1 contrast against Granary's dark background)", () => {
    setSkin("granary");
    render(<MastheadMark />);
    const svg = screen.getByRole("img", { name: "Consus" });
    expect(svg.innerHTML).not.toMatch(/#362B6B|#FAF7F0/i);
    expect(svg.innerHTML).toContain("var(--consus-accent)");
    expect(svg.innerHTML).toContain("var(--consus-bg)");
  });

  it("accepts a size prop for the onboarding screen's larger rendering", () => {
    setSkin("granary");
    render(<MastheadMark size={36} />);
    const svg = screen.getByRole("img", { name: "Consus" });
    expect(svg.getAttribute("width")).toBe("36");
    expect(svg.getAttribute("height")).toBe("36");
  });
});
