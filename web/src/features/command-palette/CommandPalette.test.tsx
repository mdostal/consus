import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { DiagramView } from "../projects/DiagramView";
import { ArchitectureDiagramView } from "../projects/ArchitectureDiagramView";
import { __resetDiagramActionRegistryForTests } from "./diagramActionRegistry";

const EPICS = [
  {
    id: "epic-a",
    title: "Epic A",
    stories: [{ id: "s1", title: "Story One", complexity: "low", dependsOn: [] }],
  },
];

const TOP_LEVEL = 'graph TD\n  root["consus"]\n  root --> src["src"]';
const FULL_COMPONENT = 'graph TD\n  root["consus"]\n  root --> src["src"]';

/**
 * Mirrors the real, shipped layout (App.tsx's ProjectsSection, ~L395-425):
 * the command palette mounted once, globally, alongside BOTH diagram kinds
 * stacked simultaneously on the page — there are no tabs to switch between
 * (the story spec's "switch diagram tab" framing was written against an
 * exploratory mockup, not the real, now-built app). Uses the real
 * DiagramView/ArchitectureDiagramView components (not stand-ins) so
 * registration, focus, and — critically — the DiagramCanvas real
 * node-label-edit input used by this file's input-focus-guard test are all
 * the genuine article, not synthetic.
 */
async function renderHarness({
  onProposeChangeCascade = vi.fn(),
  onProposeChangeArchitecture = vi.fn(),
}: {
  onProposeChangeCascade?: ReturnType<typeof vi.fn>;
  onProposeChangeArchitecture?: ReturnType<typeof vi.fn>;
} = {}) {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <>
        <CommandPalette />
        <DiagramView repo="consus" epics={EPICS} onProposeChange={onProposeChangeCascade} />
        <ArchitectureDiagramView
          repo="consus"
          topLevel={TOP_LEVEL}
          fullComponent={FULL_COMPONENT}
          onProposeChange={onProposeChangeArchitecture}
        />
      </>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { ...utils, onProposeChangeCascade, onProposeChangeArchitecture };
}

afterEach(() => {
  __resetDiagramActionRegistryForTests();
  document.documentElement.style.removeProperty("--consus-edge-style");
  document.documentElement.removeAttribute("data-skin");
});

describe("CommandPalette — opening", () => {
  it("is closed by default, with a visible trigger button present so an operator who hasn't learned the shortcut can still find it", async () => {
    await renderHarness();
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(screen.getByTestId("command-palette-trigger")).toBeInTheDocument();
  });

  it("opens on Ctrl+K (non-Mac) with a real, non-empty action list reflecting the actually-mounted diagrams — not a placeholder", async () => {
    await renderHarness();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    const items = screen.getAllByRole("option");
    expect(items.length).toBeGreaterThan(0);
    expect(screen.getByText(/focus consus epic\/story diagram/i)).toBeInTheDocument();
    expect(screen.getByText(/focus consus architecture diagram/i)).toBeInTheDocument();
  });

  it("opens on ⌘K (Mac) too", async () => {
    await renderHarness();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("also opens via the visible trigger button — every shortcut has a working clickable entry point", async () => {
    await renderHarness();
    fireEvent.click(screen.getByTestId("command-palette-trigger"));
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });
});

describe("CommandPalette — filtering by typing", () => {
  it("narrows the list to matching actions as the operator types", async () => {
    await renderHarness();
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "architecture" } });

    const items = screen.getAllByRole("option");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).toHaveTextContent(/architecture/i);
    }
  });

  it("shows an honest empty state for a query matching nothing", async () => {
    await renderHarness();
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "zzz-not-a-real-action" } });

    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

describe("CommandPalette — selecting an action", () => {
  it("selecting via keyboard (Enter) executes it and closes the palette", async () => {
    await renderHarness();
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "show consus epic/story diagram source" },
    });
    fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "Enter" });

    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("diagram-source-panel")[0]).toHaveAttribute("data-open", "true");
  });

  it("selecting via click executes it and closes the palette", async () => {
    await renderHarness();
    fireEvent.click(screen.getByTestId("command-palette-trigger"));

    fireEvent.click(screen.getByText(/show consus architecture diagram source/i));

    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    const panels = screen.getAllByTestId("diagram-source-panel");
    expect(panels[1]).toHaveAttribute("data-open", "true"); // architecture's own panel, not the cascade's
    expect(panels[0]).toHaveAttribute("data-open", "false");
  });
});

describe("CommandPalette — the two diagram-focus shortcuts (adapted from 'switch tab' to the real stacked layout)", () => {
  it("'1' scrolls to and focuses the epic/story cascade diagram directly, as a global shortcut, without opening the palette", async () => {
    await renderHarness();
    const cascadeRoot = screen.getByTestId("diagram-view-root");
    const scrollSpy = vi.fn();
    (cascadeRoot as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy;

    fireEvent.keyDown(window, { key: "1" });

    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(scrollSpy).toHaveBeenCalled();
    expect(cascadeRoot).toHaveFocus();
  });

  it("'2' scrolls to and focuses the architecture diagram directly, as a global shortcut", async () => {
    await renderHarness();
    const architectureRoot = screen.getByTestId("architecture-diagram-view-root");
    const scrollSpy = vi.fn();
    (architectureRoot as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy;

    fireEvent.keyDown(window, { key: "2" });

    expect(scrollSpy).toHaveBeenCalled();
    expect(architectureRoot).toHaveFocus();
  });

  it("both focus shortcuts also have working clickable palette entries", async () => {
    await renderHarness();
    const cascadeRoot = screen.getByTestId("diagram-view-root");

    fireEvent.click(screen.getByTestId("command-palette-trigger"));
    fireEvent.click(screen.getByTestId("command-palette-item-focus:cascade"));

    expect(cascadeRoot).toHaveFocus();
  });
});

describe("CommandPalette — source-panel toggle shortcut", () => {
  it("defaults to the cascade diagram before any focus shortcut has been used", async () => {
    await renderHarness();
    fireEvent.keyDown(window, { key: "s" });
    expect(screen.getAllByTestId("diagram-source-panel")[0]).toHaveAttribute("data-open", "true");
  });

  it("behaves identically to clicking the real on-screen toggle button, for whichever diagram was last focused", async () => {
    await renderHarness();

    fireEvent.keyDown(window, { key: "2" }); // make the architecture diagram active
    fireEvent.keyDown(window, { key: "s" });

    const panels = screen.getAllByTestId("diagram-source-panel");
    expect(panels[1]).toHaveAttribute("data-open", "true");
    expect(panels[0]).toHaveAttribute("data-open", "false");

    // The real on-screen button closes it exactly the same way the shortcut opened it.
    fireEvent.click(screen.getAllByTestId("diagram-source-panel-toggle")[1]);
    expect(screen.getAllByTestId("diagram-source-panel")[1]).toHaveAttribute("data-open", "false");
  });
});

describe("CommandPalette — fire shortcut respects the real disabled/enabled state", () => {
  it("does nothing when there are zero pending changes — never a silent no-op that looks like it did something — and the palette entry is disabled to match", async () => {
    const onProposeChangeCascade = vi.fn();
    await renderHarness({ onProposeChangeCascade });

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "f" });

    expect(onProposeChangeCascade).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("command-palette-trigger"));
    expect(screen.getByTestId("command-palette-item-fire:cascade")).toBeDisabled();
  });

  it("fires the active diagram identically to clicking its real 'Fire to harness' button once there's a real pending change", async () => {
    const onProposeChangeCascade = vi.fn();
    await renderHarness({ onProposeChangeCascade });

    fireEvent.click(screen.getAllByTestId("diagram-canvas-add-node")[0]); // real pending change, cascade
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "f" });

    expect(onProposeChangeCascade).toHaveBeenCalledTimes(1);
    const call = onProposeChangeCascade.mock.calls[0][0];
    expect(call.diff).toContain("+ node New node 1");
  });

  it("the palette's own Fire entry is clickable and enabled once there's a real pending change on the architecture diagram", async () => {
    const onProposeChangeArchitecture = vi.fn();
    await renderHarness({ onProposeChangeArchitecture });

    fireEvent.click(screen.getAllByTestId("diagram-canvas-add-node")[1]); // architecture diagram
    fireEvent.click(screen.getByTestId("command-palette-trigger"));
    const fireEntry = screen.getByTestId("command-palette-item-fire:architecture");
    expect(fireEntry).toBeEnabled();

    fireEvent.click(fireEntry);

    expect(onProposeChangeArchitecture).toHaveBeenCalledTimes(1);
  });
});

describe("CommandPalette — global shortcuts never hijack real typing (critical)", () => {
  it("typing into DiagramCanvas's real node-label-edit input does not trigger any global shortcut", async () => {
    const onProposeChangeCascade = vi.fn();
    await renderHarness({ onProposeChangeCascade });

    // Enter the real click-to-edit label flow from s2 — the exact input
    // DiagramCanvas.test.tsx exercises, not a synthetic stand-in.
    fireEvent.click(screen.getByTestId("diagram-node-label-story:s1"));
    const input = screen.getByTestId("diagram-node-input-story:s1");
    expect(input).toHaveFocus();

    // "1", "f", and "s" are all bound to global shortcuts (focus-cascade,
    // fire, toggle-source) — typing them into this focused label-edit input
    // must type normally, never trigger those shortcuts.
    fireEvent.change(input, { target: { value: "1f label" } });
    fireEvent.keyDown(input, { key: "f" });
    fireEvent.keyDown(input, { key: "s" });
    fireEvent.keyDown(input, { key: "2" });

    expect(input).toHaveValue("1f label"); // the input genuinely received the typed characters
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("diagram-source-panel")[0]).toHaveAttribute("data-open", "false");
    expect(screen.getAllByTestId("diagram-source-panel")[1]).toHaveAttribute("data-open", "false");

    fireEvent.blur(input);
    expect(onProposeChangeCascade).not.toHaveBeenCalled(); // no fire was triggered by the guarded 'f' keydown
  });

  it("⌘K still opens the palette even while that same input is focused — a modifier chord, not typed text, so it never hijacks normal typing", async () => {
    await renderHarness();
    fireEvent.click(screen.getByTestId("diagram-node-label-story:s1"));
    const input = screen.getByTestId("diagram-node-input-story:s1");

    fireEvent.keyDown(input, { key: "k", metaKey: true });

    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });
});

/**
 * Adds one extra element to the standard harness: a plain stand-in button
 * for HarnessConnectBanner's real dismiss button, mounted as a genuine
 * sibling elsewhere in the DOM — not a synthetic assertion-only prop, an
 * actual focusable element a real Tab press could reach. This mirrors the
 * audit's own live reproduction of the bug this file's new "focus trap"
 * describe block below fixes: open the palette, press Tab once, and watch
 * whether focus lands here (it must never again, once s2 lands).
 */
async function renderFocusTrapHarness({
  onProposeChangeCascade = vi.fn(),
  onProposeChangeArchitecture = vi.fn(),
}: {
  onProposeChangeCascade?: ReturnType<typeof vi.fn>;
  onProposeChangeArchitecture?: ReturnType<typeof vi.fn>;
} = {}) {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <>
        <CommandPalette />
        <DiagramView repo="consus" epics={EPICS} onProposeChange={onProposeChangeCascade} />
        <ArchitectureDiagramView
          repo="consus"
          topLevel={TOP_LEVEL}
          fullComponent={FULL_COMPONENT}
          onProposeChange={onProposeChangeArchitecture}
        />
        <button type="button" data-testid="harness-banner-dismiss-standin">
          Dismiss
        </button>
      </>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { ...utils, onProposeChangeCascade, onProposeChangeArchitecture };
}

/** The real, current in-palette Tab order: the search input, then every
 *  non-disabled result-list item, in DOM order — computed from the live DOM
 *  rather than hardcoded, so these specs stay correct regardless of exactly
 *  which/how-many actions are registered. */
function getExpectedFocusOrder(): HTMLElement[] {
  const input = screen.getByTestId("command-palette-input");
  const items = screen.getAllByRole("option").filter((el) => !(el as HTMLButtonElement).disabled);
  return [input, ...items];
}

describe("CommandPalette — genuine Tab-cycle focus trap (s2, consus-phase20)", () => {
  it("Tab cycles forward through every in-palette focusable element, wraps the last back to the first, and never once lands on a real sibling element outside the palette — the audit's own live-repro scenario, fixed", async () => {
    await renderFocusTrapHarness();
    fireEvent.click(screen.getByTestId("command-palette-trigger"));

    const order = getExpectedFocusOrder();
    expect(order.length).toBeGreaterThan(1); // a real, non-trivial list, not a degenerate single-element case
    expect(order[0]).toHaveFocus(); // autoFocus lands on the search input first

    const bannerDismissStandIn = screen.getByTestId("harness-banner-dismiss-standin");
    const trigger = screen.getByTestId("command-palette-trigger");

    for (let i = 0; i < order.length; i++) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
      const expected = order[(i + 1) % order.length];
      expect(expected).toHaveFocus();
      expect(bannerDismissStandIn).not.toHaveFocus();
      expect(trigger).not.toHaveFocus();
    }

    // A full cycle landed back on the first element — a real wrap, not a
    // dead end that fell through to the page.
    expect(order[0]).toHaveFocus();
  });

  it("Shift+Tab from the first focusable element wraps to the last — the reverse-direction case — never escaping to the trigger button that precedes the palette in the DOM", async () => {
    await renderFocusTrapHarness();
    fireEvent.click(screen.getByTestId("command-palette-trigger"));

    const order = getExpectedFocusOrder();
    expect(order[0]).toHaveFocus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab", shiftKey: true });

    expect(order[order.length - 1]).toHaveFocus();
    expect(screen.getByTestId("command-palette-trigger")).not.toHaveFocus();

    // And Shift+Tab from there moves back one step, still fully contained.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab", shiftKey: true });
    expect(order[order.length - 2]).toHaveFocus();
  });

  it("existing arrow-key list navigation, Enter-to-select, and type-to-filter all keep working unchanged now that the trap is wired in", async () => {
    const onProposeChangeCascade = vi.fn();
    await renderFocusTrapHarness({ onProposeChangeCascade });
    fireEvent.click(screen.getByTestId("command-palette-trigger"));

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "architecture" } });
    const items = screen.getAllByRole("option");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).toHaveTextContent(/architecture/i);
    }

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[Math.min(1, items.length - 1)]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });
});

describe("CommandPalette — focus returns to the actual pre-open element on close (not a hardcoded trigger assumption)", () => {
  /**
   * A plain, stable, always-present button elsewhere on the page — the
   * architecture diagram's "Full component" tab button — used as the
   * "some other element had focus" pre-open target per the design
   * decision's own framing (opened via the global shortcut from wherever
   * focus happens to be, not necessarily the ⌘K trigger). Deliberately not
   * DiagramCanvas's node-label edit input: that input commits and unmounts
   * itself on blur (its own, unrelated `onBlur={commit}`), so losing focus
   * to the palette would make it vanish regardless of this story's fix —
   * a real interaction of a different feature, not something this focus
   * trap should be judged against.
   */
  function getPreOpenTarget(): HTMLElement {
    return screen.getAllByRole("tab", { name: /full component/i })[0];
  }

  it("returns focus to whatever had it before the palette opened via the global shortcut when closed via Escape", async () => {
    await renderHarness();
    const preOpenTarget = getPreOpenTarget();
    preOpenTarget.focus();
    expect(preOpenTarget).toHaveFocus();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("command-palette-input")).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "Escape" });

    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(preOpenTarget).toHaveFocus();
    expect(screen.getByTestId("command-palette-trigger")).not.toHaveFocus();
  });

  it("returns focus to the actual pre-open element when closed via selecting an item", async () => {
    await renderHarness();
    const preOpenTarget = getPreOpenTarget();
    preOpenTarget.focus();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByTestId("command-palette-item-focus:cascade"));

    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(preOpenTarget).toHaveFocus();
  });

  it("returns focus to the actual pre-open element when closed via clicking the backdrop", async () => {
    await renderHarness();
    const preOpenTarget = getPreOpenTarget();
    preOpenTarget.focus();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByTestId("command-palette-backdrop"));

    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(preOpenTarget).toHaveFocus();
  });

  it("returns focus to the ⌘K trigger button when that's genuinely what had focus before open — the common case, still correct, just not hardcoded", async () => {
    await renderHarness();
    const trigger = screen.getByTestId("command-palette-trigger");
    trigger.focus();
    fireEvent.click(trigger); // clicking it both focuses it (jsdom needs the explicit .focus() above) and opens the palette

    fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "Escape" });

    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("CommandPalette — universal across all 3 skins", () => {
  it("renders the same trigger + palette structure and non-empty action set regardless of the active skin", async () => {
    for (const skin of ["drafting", "case-board", "harness"] as const) {
      document.documentElement.setAttribute("data-skin", skin);
      const { unmount } = await renderHarness();

      expect(screen.getByTestId("command-palette-trigger")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("command-palette-trigger"));
      const items = screen.getAllByRole("option");
      expect(items.length).toBeGreaterThan(0);

      unmount();
      __resetDiagramActionRegistryForTests();
      document.documentElement.removeAttribute("data-skin");
    }
  });
});
