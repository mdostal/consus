import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { HarnessConnectBanner } from "./HarnessConnectBanner";
import { HARNESS_BANNER_COLLAPSED_STORAGE_KEY } from "./useHarnessBannerCollapsed";

const SKINS = ["drafting", "case-board", "harness"] as const;
const THEMES = ["light", "dark"] as const;

function setSkinAndTheme(skin: string | null, theme: string | null) {
  if (skin === null) document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", skin);

  if (theme === null) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

describe("HarnessConnectBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSkinAndTheme(null, null);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    setSkinAndTheme(null, null);
  });

  it("renders expanded by default: the exact command, an explanation, and references to SKILL.md/api-reference.md", () => {
    render(<HarnessConnectBanner />);
    expect(screen.getByText("npm run agent:init")).toBeInTheDocument();
    expect(screen.getByText(/installs consus's agent-facing skill/i)).toBeInTheDocument();
    expect(screen.getByText("skills/consus/SKILL.md")).toBeInTheDocument();
    expect(screen.getByText("docs/api-reference.md")).toBeInTheDocument();
  });

  it("collapses to a small reopenable affordance when dismissed — not a full disappear", () => {
    render(<HarnessConnectBanner />);
    fireEvent.click(screen.getByRole("button", { name: /collapse the claude code connect banner/i }));

    expect(screen.queryByText("npm run agent:init")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show the claude code connect banner/i })
    ).toBeInTheDocument();
  });

  it("dismiss persists across a simulated reload (re-mount with the same localStorage), not just an in-test re-render", () => {
    const { unmount } = render(<HarnessConnectBanner />);
    fireEvent.click(screen.getByRole("button", { name: /collapse the claude code connect banner/i }));
    expect(window.localStorage.getItem(HARNESS_BANNER_COLLAPSED_STORAGE_KEY)).toBe("true");
    unmount();

    // Simulated reload: a fresh mount reading the same, real localStorage.
    render(<HarnessConnectBanner />);
    expect(screen.queryByText("npm run agent:init")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show the claude code connect banner/i })
    ).toBeInTheDocument();
  });

  it("the collapsed affordance reopens the full banner when clicked — reversible, not one-way", () => {
    window.localStorage.setItem(HARNESS_BANNER_COLLAPSED_STORAGE_KEY, "true");
    render(<HarnessConnectBanner />);
    expect(screen.queryByText("npm run agent:init")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show the claude code connect banner/i }));

    expect(screen.getByText("npm run agent:init")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /show the claude code connect banner/i })
    ).not.toBeInTheDocument();
  });

  describe("across all 3 skins x both themes (6 combinations)", () => {
    for (const skin of SKINS) {
      for (const theme of THEMES) {
        it(`renders (expanded and collapsed) under skin="${skin}" theme="${theme}"`, () => {
          setSkinAndTheme(skin, theme);
          const { unmount } = render(<HarnessConnectBanner />);

          expect(screen.getByText("npm run agent:init")).toBeInTheDocument();

          fireEvent.click(
            screen.getByRole("button", { name: /collapse the claude code connect banner/i })
          );
          expect(
            screen.getByRole("button", { name: /show the claude code connect banner/i })
          ).toBeInTheDocument();

          unmount();
        });
      }
    }
  });
});
