# Design Discussion: consus-phase20-diagram-editor-a11y

## Goal

The "Interaction polish / accessibility pass" backlog item sat as vague, unscoped `backlogged` all
session. Before building anything against it, a real audit fork read the actual shipped code for
consus-phase18/19's newest surfaces (the React Flow diagram editor, the skin/theme system, the
command palette, the harness connect banner) and live-verified one finding in a running browser —
turning a vague line item into four concrete, cited findings. This epic fixes the three that
warrant real story-level work; the fourth ("what's already fine") is explicitly not re-litigated.

## Audit findings (verified directly against the code, not just trusted from the audit report)

1. **Node dragging has zero keyboard equivalent.** `web/src/features/projects/DiagramCanvas.tsx`
   (~line 224) — the drag handle is a bare `<span className="diagram-canvas__drag-handle"
   aria-label={...}>`, no `tabIndex`, no `role`, no `onKeyDown`. Confirmed by direct read: never in
   the tab order, no keyboard path exists anywhere in the file for moving a node.
2. **Edge selection/deletion has zero keyboard equivalent.** Same file, `DiagramEdgeComponent`
   (~line 276) — the entire interactive surface is an SVG `<path onClick={...}>`, no
   `tabIndex`/`role`/keyboard handler. Compounding this: `<ReactFlow deleteKeyCode={null} ...>`
   (~line 624) explicitly disables React Flow's own built-in keyboard-Delete support, with nothing
   wired in its place.
3. **The command palette's focus trap doesn't actually trap.** `CommandPalette.tsx` sets
   `role="dialog" aria-modal="true"` (~line 100) but implements no focus containment and no
   focus-return-to-trigger on close. **Live-verified by the audit**: opened the palette, pressed
   Tab once, focus landed on the HarnessConnectBanner's dismiss button — a completely unrelated
   element elsewhere on the page — while the palette remained visibly open. A real, reproducible
   contradiction of the `aria-modal` semantic it claims.
4. **`prefers-reduced-motion` is never checked anywhere in the codebase** (confirmed via a
   zero-result grep across `app.css`, `tokens.css`, every `theme/skins/*.tsx`). The one real
   infinite animation affected: Harness skin's terminal cursor blink (`app.css` ~line 1674,
   `animation: harness-cursor-blink 1s steps(1, jump-none) infinite`), which runs unconditionally
   regardless of OS motion preference.

**What's already in good shape, not being re-touched here:** `ThemeSkinPicker`,
`HarnessConnectBanner`, `DiagramSourcePanel`, `DiagramMetadataStrip`, and the command palette's own
list items all have correct real ARIA attributes and are genuine `<button>` elements — properly
keyboard-operable already. Connect-mode (adding an edge) is actually keyboard-operable end-to-end
today via two Enter presses on node label buttons — the audit initially expected this to be a gap
and found it wasn't. Node-label editing and node removal are both real, accessible `<button>`s
already. None of this needs work in this epic.

## Proposed approach — 3 independent stories, no real dependencies between them

Each touches a materially different part of the codebase (DiagramCanvas.tsx / CommandPalette.tsx /
app.css's Harness skin block) with no shared state — dispatched and built in parallel rather than
sequentially, unlike most of tonight's other epics where later stories genuinely depended on
earlier ones landing first.

1. **Keyboard-accessible node move + edge delete** (`DiagramCanvas.tsx`). The drag handle becomes a
   real, focusable, keyboard-operable control — arrow keys nudge the node by a fixed step while it
   has focus (a real, if modest, movement equivalent to drag; exact step size left to
   implementation, this is a genuine "focused point" like s2's drag-vs-click disambiguation was).
   The edge path becomes focusable too, with Enter/Space triggering the same snip behavior a click
   already does. `deleteKeyCode={null}` stays disabled at the React Flow level (it operates on
   whatever's *React-Flow-selected*, which isn't this app's own multi-select model), but a real
   keyboard path for deletion is wired through the app's own selection state instead — not simply
   re-enabling the disabled prop.
2. **A real focus trap for the command palette.** `CommandPalette.tsx` gains genuine Tab-cycle
   containment while open (focus never escapes to the page behind it) and returns focus to
   whatever triggered it (the `⌘K` trigger button, or wherever focus was before opening) on close.
   Fixes the exact live-reproduced bug from the audit.
3. **`prefers-reduced-motion` support for the Harness cursor blink.** A media query guards the
   `harness-cursor-blink` animation — reduced motion gets a static (non-animated) cursor
   representation instead of the infinite blink. Scoped narrowly to this one confirmed-missing
   case, not a speculative sweep for other motion issues the audit didn't find (the audit explicitly
   noted the two other `transition:` declarations in the codebase are too minor — 0.12s color/border
   fades — to be a real concern on their own).

## Risks

- **Keyboard node-move step size is a real design choice with no single right answer** — too small
  feels unresponsive, too large feels imprecise. Explicitly left as a "focused point" for the
  implementer to tune, matching how consus-phase18's s2 handled the drag-vs-click hit-target
  question — acceptance criteria test the *behavior* (arrow keys move the node a real, visible
  amount) without over-specifying an exact pixel value.
- **Focus-trap implementations are a common source of new bugs** (trapping too aggressively, e.g.
  preventing `⌘K` itself from closing the palette, or breaking Tab navigation for genuinely nested
  interactive elements inside the palette's own results list). Acceptance criteria require testing
  both directions: focus can't escape while open, AND normal in-palette keyboard navigation
  (arrow-key list nav, Enter-to-select) keeps working exactly as it did before this story.

## Open questions

None outstanding — every finding above is either fixed by one of the 3 stories or explicitly
excluded with reasoning. If a new ambiguous call comes up during a story, stop and ask — standing
practice.
