import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useGlobalShortcuts, type CommandPaletteAction } from "./useGlobalShortcuts";

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
          className="command-palette"
          data-testid="command-palette"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
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
