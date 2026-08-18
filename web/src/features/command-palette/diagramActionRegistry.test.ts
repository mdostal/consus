import { describe, it, expect, vi, afterEach } from "vitest";
import {
  registerDiagramActions,
  subscribeDiagramActions,
  getDiagramActionsSnapshot,
  __resetDiagramActionRegistryForTests,
  type DiagramActions,
  type DiagramKind,
} from "./diagramActionRegistry";

function makeActions(kind: DiagramKind, overrides: Partial<DiagramActions> = {}): DiagramActions {
  return {
    kind,
    label: `${kind} label`,
    focus: vi.fn(),
    toggleSourcePanel: vi.fn(),
    sourcePanelOpen: false,
    ...overrides,
  };
}

afterEach(() => {
  __resetDiagramActionRegistryForTests();
});

/**
 * Real, currently-mounted DiagramView/ArchitectureDiagramView instances
 * (s4, consus-phase18) register their own live action set here on mount and
 * unregister on unmount — the command palette and global shortcuts (s4)
 * read this registry rather than any hardcoded/placeholder action list, so
 * the palette's contents can never drift from what's actually on screen.
 */
describe("diagramActionRegistry", () => {
  it("starts empty", () => {
    expect(getDiagramActionsSnapshot()).toEqual([]);
  });

  it("registers a diagram's actions and includes them in the snapshot", () => {
    const actions = makeActions("cascade");
    registerDiagramActions(actions);
    expect(getDiagramActionsSnapshot()).toEqual([actions]);
  });

  it("replaces a prior registration for the same kind rather than duplicating it", () => {
    registerDiagramActions(makeActions("cascade", { label: "old" }));
    registerDiagramActions(makeActions("cascade", { label: "new" }));
    const snapshot = getDiagramActionsSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].label).toBe("new");
  });

  it("the unregister function returned from registration removes exactly that registration", () => {
    const actions = makeActions("cascade");
    const unregister = registerDiagramActions(actions);
    unregister();
    expect(getDiagramActionsSnapshot()).toEqual([]);
  });

  it("a stale unregister (from a registration already replaced by a newer one) never clobbers the newer registration — guards a real React re-render race, the same shape DiagramCanvas.tsx documents for its own onChange-before-setState ordering", () => {
    const first = makeActions("cascade", { label: "first" });
    const unregisterFirst = registerDiagramActions(first);
    registerDiagramActions(makeActions("cascade", { label: "second" }));

    unregisterFirst(); // stale — "second" already replaced "first" in the registry

    const snapshot = getDiagramActionsSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].label).toBe("second");
  });

  it("notifies subscribers on register and on unregister", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDiagramActions(listener);

    const unregister = registerDiagramActions(makeActions("cascade"));
    expect(listener).toHaveBeenCalledTimes(1);

    unregister();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDiagramActions(listener);
    unsubscribe();

    registerDiagramActions(makeActions("cascade"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("getDiagramActionsSnapshot returns a stable array identity across calls with no intervening change (required by useSyncExternalStore, which warns/loops on an ever-new array)", () => {
    registerDiagramActions(makeActions("cascade"));
    const a = getDiagramActionsSnapshot();
    const b = getDiagramActionsSnapshot();
    expect(a).toBe(b);
  });

  it("returns a new snapshot identity after a real change", () => {
    registerDiagramActions(makeActions("cascade"));
    const a = getDiagramActionsSnapshot();
    registerDiagramActions(makeActions("architecture"));
    const b = getDiagramActionsSnapshot();
    expect(a).not.toBe(b);
  });

  it("supports both kinds registered independently at once — the real shape once a project is selected (both diagrams stacked, see App.tsx's ProjectsSection)", () => {
    registerDiagramActions(makeActions("cascade"));
    registerDiagramActions(makeActions("architecture"));
    expect(getDiagramActionsSnapshot().map((a) => a.kind).sort()).toEqual(["architecture", "cascade"]);
  });
});
