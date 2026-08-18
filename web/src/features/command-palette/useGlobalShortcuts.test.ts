import { describe, it, expect, vi } from "vitest";
import { isEditableElementFocused, buildPaletteActions } from "./useGlobalShortcuts";
import type { DiagramActions, DiagramKind } from "./diagramActionRegistry";

describe("isEditableElementFocused — the real focus-state guard global shortcuts check", () => {
  it("is false when nothing (or the body) has focus", () => {
    expect(isEditableElementFocused(null)).toBe(false);
    expect(isEditableElementFocused(document.body)).toBe(false);
  });

  it("is true for a real <input> — the exact element family DiagramCanvas's own node-label-edit input (s2) belongs to", () => {
    const input = document.createElement("input");
    expect(isEditableElementFocused(input)).toBe(true);
  });

  it("is true for a <textarea> and a <select>", () => {
    expect(isEditableElementFocused(document.createElement("textarea"))).toBe(true);
    expect(isEditableElementFocused(document.createElement("select"))).toBe(true);
  });

  it("is true for a contentEditable element (e.g. a doc-section editor)", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isEditableElementFocused(div)).toBe(true);
  });

  it("is false for a plain button, div, or link — normal app chrome shortcuts must still work there", () => {
    expect(isEditableElementFocused(document.createElement("button"))).toBe(false);
    expect(isEditableElementFocused(document.createElement("div"))).toBe(false);
    expect(isEditableElementFocused(document.createElement("a"))).toBe(false);
  });
});

function makeDiagram(kind: DiagramKind, overrides: Partial<DiagramActions> = {}): DiagramActions {
  return {
    kind,
    label: `${kind} diagram`,
    focus: vi.fn(),
    toggleSourcePanel: vi.fn(),
    sourcePanelOpen: false,
    ...overrides,
  };
}

describe("buildPaletteActions — pure: turns real registered diagrams into palette entries", () => {
  it("is empty when nothing is registered — never a placeholder/static list", () => {
    expect(buildPaletteActions([])).toEqual([]);
  });

  it("includes a Focus and a source-panel-toggle entry for every registered diagram", () => {
    const actions = buildPaletteActions([makeDiagram("cascade"), makeDiagram("architecture")]);
    const labels = actions.map((a) => a.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Focus cascade diagram",
        "Focus architecture diagram",
        "Show cascade diagram source",
        "Show architecture diagram source",
      ]),
    );
  });

  it("gives the two diagrams' Focus entries distinct number-key hints, matching the adapted number-key shortcuts", () => {
    const actions = buildPaletteActions([makeDiagram("cascade"), makeDiagram("architecture")]);
    expect(actions.find((a) => a.id === "focus:cascade")?.shortcutHint).toBe("1");
    expect(actions.find((a) => a.id === "focus:architecture")?.shortcutHint).toBe("2");
  });

  it("flips the toggle entry's label to Hide when that diagram's source panel is already open", () => {
    const actions = buildPaletteActions([makeDiagram("cascade", { sourcePanelOpen: true })]);
    expect(actions.find((a) => a.id === "toggle-source:cascade")?.label).toBe("Hide cascade diagram source");
  });

  it("omits the Fire entry entirely for a diagram with no fire capability at all (e.g. architecture with no onProposeChange wired) — matching the real on-screen button, which likewise doesn't render", () => {
    const actions = buildPaletteActions([makeDiagram("cascade")]); // no `fire` field at all
    expect(actions.some((a) => a.id.startsWith("fire:"))).toBe(false);
  });

  it("includes a Fire entry, disabled, when fire exists but fireEnabled is false — never enabled with nothing to fire", () => {
    const fire = vi.fn();
    const actions = buildPaletteActions([makeDiagram("cascade", { fire, fireEnabled: false })]);
    const fireAction = actions.find((a) => a.id === "fire:cascade")!;
    expect(fireAction.disabled).toBe(true);
  });

  it("includes an enabled Fire entry that invokes the real fire function when there's a real pending change", () => {
    const fire = vi.fn();
    const actions = buildPaletteActions([makeDiagram("cascade", { fire, fireEnabled: true })]);
    const fireAction = actions.find((a) => a.id === "fire:cascade")!;
    expect(fireAction.disabled).toBeFalsy();
    fireAction.run();
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("the Focus and toggle entries invoke the diagram's own real callbacks", () => {
    const focus = vi.fn();
    const toggleSourcePanel = vi.fn();
    const actions = buildPaletteActions([makeDiagram("cascade", { focus, toggleSourcePanel })]);

    actions.find((a) => a.id === "focus:cascade")!.run();
    expect(focus).toHaveBeenCalledTimes(1);

    actions.find((a) => a.id === "toggle-source:cascade")!.run();
    expect(toggleSourcePanel).toHaveBeenCalledTimes(1);
  });
});
