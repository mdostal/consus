import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  getDiagramActionsSnapshot,
  subscribeDiagramActions,
  type DiagramActions,
  type DiagramKind,
} from "./diagramActionRegistry";

/** One real, currently-invocable entry in the command palette — every
 *  shortcut in the floor below also has a corresponding entry here, so
 *  nothing is keyboard-only (design-discussion.md resolved decision #7). */
export interface CommandPaletteAction {
  id: string;
  label: string;
  /** Cosmetic hint shown next to the entry, e.g. "1" or "f" — the real
   *  binding lives in the keydown handler in useGlobalShortcuts below; this
   *  is just what's displayed. */
  shortcutHint?: string;
  disabled?: boolean;
  run: () => void;
}

/**
 * True when a real text-entry surface currently has DOM focus — an
 * <input>, <textarea>, <select>, or any contentEditable element. The exact
 * family DiagramCanvas's own click-to-edit node-label input (s2,
 * consus-phase18) belongs to, and the same family a doc-section editor's
 * textarea belongs to. Global single-key shortcuts must never fire while
 * this is true — a plain, unmodified keystroke here must always be normal
 * typing, never a shortcut.
 */
export function isEditableElementFocused(active: Element | null = document.activeElement): boolean {
  if (!active) return false;
  const tag = active.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (active as HTMLElement).isContentEditable === true;
}

/** Adapted "switch diagram tab" -> "focus diagram section" shortcut keys
 *  (see CommandPalette.test.tsx's header comment / this story's real-app
 *  correction): the real app stacks both diagram kinds simultaneously
 *  rather than showing them as tabs, so "1"/"2" scroll-to-and-focus a
 *  section instead of switching between mutually-exclusive tabs. */
const FOCUS_KEY_FOR_KIND: Record<DiagramKind, string> = {
  cascade: "1",
  architecture: "2",
};

const TOGGLE_SOURCE_KEY = "s";
const FIRE_KEY = "f";

/**
 * Pure: turns the currently-registered real diagram instances into the
 * palette's action list — never a placeholder/static list (design-
 * discussion.md decision #7's own explicit requirement). Exported
 * standalone, like DiagramView.tsx's buildCascadeGraph, so it's
 * unit-testable without mounting any component or DOM.
 */
export function buildPaletteActions(diagramActions: DiagramActions[]): CommandPaletteAction[] {
  const actions: CommandPaletteAction[] = [];

  for (const d of diagramActions) {
    actions.push({
      id: `focus:${d.kind}`,
      label: `Focus ${d.label}`,
      shortcutHint: FOCUS_KEY_FOR_KIND[d.kind],
      run: d.focus,
    });

    actions.push({
      id: `toggle-source:${d.kind}`,
      label: `${d.sourcePanelOpen ? "Hide" : "Show"} ${d.label} source`,
      shortcutHint: TOGGLE_SOURCE_KEY,
      run: d.toggleSourcePanel,
    });

    if (d.fire) {
      const fire = d.fire;
      actions.push({
        id: `fire:${d.kind}`,
        label: `Fire ${d.label} to harness`,
        shortcutHint: FIRE_KEY,
        disabled: !d.fireEnabled,
        run: fire,
      });
    }
  }

  return actions;
}

export interface UseGlobalShortcutsResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** The full, real, currently-available action list — filtering by typed
   *  query happens in CommandPalette.tsx, not here. */
  actions: CommandPaletteAction[];
}

/**
 * Wires the story's shortcut floor (design-discussion.md decision #7) to
 * the real, currently-registered diagram actions:
 *
 *  - ⌘K / Ctrl+K opens the palette. This works even while a text input is
 *    focused — it's a modifier chord, not a typed character, so it can
 *    never hijack normal typing the way a bare single-key shortcut could.
 *  - "1" / "2" scroll-to-and-focus the cascade / architecture diagram
 *    section directly (the real-app-adapted form of "switch diagram tab"),
 *    and also record which diagram is "active" for the two shortcuts below.
 *  - "s" toggles the active diagram's s3 source panel.
 *  - "f" fires the active diagram to harness, respecting its real
 *    disabled-when-no-changes state (fire is simply not called at all when
 *    disabled — never a silent no-op that looks like it did something,
 *    matching the real on-screen button's own disabled attribute).
 *
 * All four single-key shortcuts are hard-guarded by isEditableElementFocused
 * so a plain character keystroke inside any real text input — a diagram
 * node label being edited (s2), a doc section, or any other input — always
 * types normally instead of firing a shortcut.
 */
export function useGlobalShortcuts(): UseGlobalShortcutsResult {
  const [isOpen, setIsOpen] = useState(false);
  const diagramActions = useSyncExternalStore(subscribeDiagramActions, getDiagramActionsSnapshot, getDiagramActionsSnapshot);
  const activeKindRef = useRef<DiagramKind | null>(null);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen(true);
        return;
      }

      // Every shortcut below is a bare, unmodified character — exactly the
      // class of keystroke a real focused text input would otherwise
      // receive as normal typing.
      if (isEditableElementFocused()) return;

      const current = getDiagramActionsSnapshot();
      const byKind = new Map(current.map((d) => [d.kind, d] as const));

      const cascade = byKind.get("cascade");
      const architecture = byKind.get("architecture");

      if (event.key === "1" && cascade) {
        activeKindRef.current = "cascade";
        cascade.focus();
        return;
      }
      if (event.key === "2" && architecture) {
        activeKindRef.current = "architecture";
        architecture.focus();
        return;
      }

      const activeKind = activeKindRef.current ?? "cascade";
      const active = byKind.get(activeKind);
      if (!active) return;

      const key = event.key.toLowerCase();
      if (key === TOGGLE_SOURCE_KEY) {
        active.toggleSourcePanel();
        return;
      }
      if (key === FIRE_KEY && active.fire && active.fireEnabled) {
        active.fire();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const actions = useMemo(() => buildPaletteActions(diagramActions), [diagramActions]);

  return { isOpen, open, close, actions };
}
