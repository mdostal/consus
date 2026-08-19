import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useGlobalShortcuts, type CommandPaletteAction } from "./useGlobalShortcuts";

/** Every element kind the palette itself can legitimately contain — the
 *  search input and the result-list item buttons today, but written
 *  generically (not "just the two known cases") so it stays correct if the
 *  panel ever grows another in-palette control. Used to compute the real
 *  Tab-cycle order for the focus trap below (s2, consus-phase20). */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Universal ⌘K command palette (s4, consus-phase18, design-discussion.md
 * resolved decision #7) — present and functionally identical in every skin;
 * only its own visual chrome is styled per-skin via the shared --consus-*
 * tokens (see app.css), the same discipline every other diagram surface
 * already follows (s1). Explicitly not decoration exclusive to the
 * Harness/terminal direction — mounted once in App.tsx, always in the DOM
 * regardless of which skin or tab is active.
 *
 * Its action list is never a static/placeholder set: it's built live from
 * whichever DiagramView/ArchitectureDiagramView instances are currently
 * mounted (see diagramActionRegistry.ts + useGlobalShortcuts.ts), so an
 * action that isn't really available right now (e.g. Fire with zero
 * pending changes) is genuinely disabled here too, not just visually
 * greyed out — and an action for a diagram that isn't mounted at all
 * (no project selected) simply isn't in the list.
 *
 * Every shortcut also has a normal clickable entry here (design decision
 * #7's second half) — nothing is keyboard-only, so an operator who hasn't
 * learned the shortcuts yet can still use every one of them, including the
 * palette's own trigger button below.
 */
export function CommandPalette() {
  const { isOpen, open, close, actions } = useGlobalShortcuts();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Genuine focus containment + focus-return (s2, consus-phase20): a real
  // accessibility audit live-verified that role="dialog" aria-modal="true"
  // was a lie — opening the palette and pressing Tab once sent focus to the
  // HarnessConnectBanner's dismiss button elsewhere on the page. Fixing
  // this requires (a) knowing exactly what had focus right before the
  // palette opened, and (b) trapping Tab/Shift+Tab inside it while open.
  //
  // The element that had focus before open is captured here, during the
  // render phase, rather than in a useEffect: effects run after commit, by
  // which point the search input's own `autoFocus` has already stolen
  // focus, so an effect would only ever see the input itself. The render
  // phase runs before any DOM mutation, so document.activeElement here is
  // still whatever was focused an instant ago — this is React's documented
  // "adjusting state while rendering" pattern (comparing against the
  // previous render's isOpen), not an effect.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [lastRenderedIsOpen, setLastRenderedIsOpen] = useState(isOpen);
  if (isOpen !== lastRenderedIsOpen) {
    setLastRenderedIsOpen(isOpen);
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    }
  }

  // Restore focus to that exact captured element on every real close path
  // (Escape, selecting an item, backdrop click — all of which funnel
  // through `close()` and thus this isOpen transition). Never a hardcoded
  // assumption that it was the ⌘K trigger button: the palette can also be
  // opened via the global keyboard shortcut from anywhere in the app.
  useEffect(() => {
    if (!isOpen && previouslyFocusedRef.current) {
      previouslyFocusedRef.current.focus();
      previouslyFocusedRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setHighlighted(0);
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q));
  }, [actions, query]);

  // Keep the highlighted index in range as filtering shrinks the list —
  // never pointing past the end (or into a now-empty list).
  useEffect(() => {
    setHighlighted((h) => Math.min(h, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const runAction = (action: CommandPaletteAction) => {
    if (action.disabled) return;
    action.run();
    close();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const action = filtered[highlighted];
      if (action) runAction(action);
    }
  };

  // The actual Tab-cycle focus trap. Deliberately fully manual (compute the
  // in-palette focusable list ourselves and move focus to the next/previous
  // entry, wrapping at both ends) rather than only intercepting at the
  // boundaries and otherwise letting the browser's native Tab order take
  // over — the palette's contents are a flat, contiguous list today so
  // boundary-only interception would happen to work in a real browser, but
  // full manual control is what actually keeps Tab from ever depending on
  // where the palette happens to sit in the rest of the page's DOM order.
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const container = dialogRef.current;
    if (!container) return;
    const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const currentIndex = active ? focusable.indexOf(active) : -1;
    let nextIndex: number;
    if (event.shiftKey) {
      nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
    } else {
      nextIndex = currentIndex === -1 || currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
    }
    focusable[nextIndex]?.focus();
  };

  return (
    <>
      <button
        type="button"
        className="command-palette-trigger"
        data-testid="command-palette-trigger"
        onClick={open}
        aria-haspopup="dialog"
        title="Command palette (⌘K / Ctrl+K)"
      >
        <span className="command-palette-trigger__key" aria-hidden="true">
          ⌘K
        </span>
        <span className="command-palette-trigger__label">Commands</span>
      </button>

      {isOpen ? (
        <div
          ref={dialogRef}
          className="command-palette"
          data-testid="command-palette"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onKeyDown={handleDialogKeyDown}
        >
          <div className="command-palette__backdrop" data-testid="command-palette-backdrop" onClick={close} />
          <div className="command-palette__panel">
            <input
              ref={inputRef}
              autoFocus
              type="text"
              className="command-palette__input"
              data-testid="command-palette-input"
              placeholder="Type a command…"
              aria-label="Search commands"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <ul className="command-palette__list" data-testid="command-palette-list" role="listbox" aria-label="Commands">
              {filtered.length === 0 ? (
                <li className="command-palette__empty" data-testid="command-palette-empty">
                  No matching actions
                </li>
              ) : (
                filtered.map((action, index) => (
                  <li key={action.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === highlighted}
                      disabled={action.disabled}
                      className={`command-palette__item${index === highlighted ? " command-palette__item--highlighted" : ""}`}
                      data-testid={`command-palette-item-${action.id}`}
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => runAction(action)}
                    >
                      <span className="command-palette__item-label">{action.label}</span>
                      {action.shortcutHint ? (
                        <span className="command-palette__hint">{action.shortcutHint}</span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
