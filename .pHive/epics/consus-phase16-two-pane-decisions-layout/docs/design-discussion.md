# Design Discussion: consus-phase16-two-pane-decisions-layout

## Goal

Today's Decisions tab renders every open decision, then every decided decision, as a single flat,
vertically-stacked list of full inline `DecisionView` cards (`web/src/App.tsx:243-282`). There is no
list+detail split and no way to link directly to one decision. This epic adds a two-pane layout — a
left-hand scannable list, a right-hand independently-scrolling detail panel — with the current
selection addressable via `?selected=<id>` on the page URL. Standalone-only, no new backend surface,
small scope, no regression to existing decisions-adjacent test coverage.

## Current-state findings

- `web/src/App.tsx:34-45` — `DecisionItem`, the shape `GET /api/decisions` returns (id, type, title,
  status, source_repo, source_body, decision_type, triage_bucket, decided_at, decision_payload).
- `web/src/App.tsx:75-237` — `DecisionView`, the actual per-item renderer the Decisions tab uses
  today. It is considerably richer than `DecisionCard`: it renders context markdown, an option
  preview gallery, the verdict/`AnswerControl` flow, a `CommentThread`, and an `AuditPanel`, each
  fetched per item on mount (`loadComments`/`loadAuditTrail`, lines 86-107).
- `web/src/App.tsx:243-282` — `DecisionsSection`, the flat-list container. Splits `decisions` into
  `open`/`decided` by `decided_at` and maps each to `<DecisionView key={d.id} item={d}
  onDecided={reload} />` with no selection concept at all.
- `web/src/App.tsx:1070-1073` and `:1159` — `App()` already owns the single `decisions` fetch
  (`GET /api/decisions?all=1` presumably, confirmed by the `?all=1`-shaped test fixtures in
  `App.test.tsx`) and a `reload()` callback, passed into `DecisionsSection` as props. `DecisionsSection`
  does no fetching of its own today — it's already a pure presentational component over data `App()`
  owns. This epic does not add a second fetch; it reuses these props as-is.
- **`DecisionCard.tsx` (`web/src/features/decisions/DecisionCard.tsx`) is not used by the Decisions
  tab at all today.** It is used exactly once, by `web/src/features/kb/KBBrowser.tsx`, to render KB
  entries. Its own docstring aspires to be "the shared rendering primitive... every other item view
  composes on top of this instead of inventing its own presentation," but `DecisionView` predates or
  ignores that and has its own, richer presentation. `DecisionCard.test.tsx` (5 tests) exercises only
  the standalone component and is untouched by anything in this epic.
- No router library is present: `web/package.json` has no `react-router-dom` (or any router)
  dependency, and `App.tsx` has no `<Route>`/`<BrowserRouter>` usage — grepped, zero hits outside
  unrelated comments. Selection-URL sync must be hand-rolled with `URLSearchParams` +
  `window.history`, not a new dependency.
- No dedicated decisions-tab test file exists. `App.test.tsx` only asserts shallow things about the
  Decisions tab: that its nav button is gated on non-empty content, and a handful of loading-state
  smoke checks against `/api/decisions` fetch mocks. There is no existing assertion about
  `DecisionsSection`'s internal layout to protect, which lowers regression risk but also means this
  story is the first to pin the tab's real behavior — the acceptance criteria below are the safety
  net.
- Archived precedent (`archive/dev-2026-08-11-pantheon-coupled` commit `8b5ce2d`) built an analogous
  `DecisionsView`/`DecisionList`/`DecisionDetailPanel` split using `react-router-dom`'s
  `useSearchParams`, `{ replace: true }` updates, a 768px collapse breakpoint, and a controlled
  `items`/`selectedId`/`onSelect` API on the list component. That tree had a router already in place
  and a much thinner per-item renderer (`DecisionCard` was in fact the tab's only renderer there).
  Neither holds on current mainline — treated as shape precedent only, not ported.

## Resolved design decision: what renders in the detail pane

The task framing describes `DecisionCard` as "the existing shared rendering primitive... reuse it
as-is inside the new detail panel." Given the finding above — `DecisionCard` is not what the
Decisions tab renders today, and `DecisionView` carries functionality `DecisionCard` doesn't have
(previews, comments, audit trail) — swapping the detail pane to `DecisionCard` would silently drop
real, currently-live functionality. That's a materially bigger change than "make the existing tab
two-pane," and conflicts with this epic's own "small scope" / "not a rewrite" constraints.

**Resolution: the detail pane renders the existing `DecisionView`, unchanged, for the selected
item.** `DecisionCard.tsx` is not modified and not newly wired into the Decisions tab by this epic —
it continues to serve `KBBrowser` exactly as before. This keeps 100% of today's per-item behavior
(verdict flow, comments, audit trail, previews) intact and satisfies the literal constraints ("you
are not modifying `DecisionCard.tsx` itself" / "`DecisionCard.test.tsx`... must keep passing as-is")
without inventing a feature regression the task didn't ask for.

## Proposed approach

Two new small files under `web/src/features/decisions/`, plus a rewrite of `DecisionsSection`'s body
in `App.tsx` (its props/signature stay the same: `{ decisions, reload }`):

1. **`useSelectedDecisionId.ts`** — a tiny hook wrapping `URLSearchParams` and
   `window.history.replaceState` (not `pushState`, to avoid one browser-history entry per row click —
   matches the archived precedent's own `{ replace: true }` choice) plus a `popstate` listener for
   back/forward support. Returns `[selectedId: string | null, select: (id: string) => void]`. No new
   dependency.
2. **`DecisionListPane.tsx`** — presentational left-pane list. Takes a duck-typed
   `{ id, title, status, decided_at, decision_type? }[]` item shape (structurally compatible with
   `DecisionItem`, no import from `App.tsx` needed) plus `selectedId`/`onSelect`, and renders compact,
   clickable rows (title, status pill, decision type) grouped under the existing "Needs you (N)" /
   "Decided (N)" headings — not a full `DecisionView`/`DecisionCard` per row, which would be
   expensive and unscannable for a list. Keyboard-activatable (`role="option"`, `tabIndex`,
   Enter/Space), mirroring the archived precedent's a11y pattern.
3. **`decisions-two-pane.css`** — new stylesheet: a two-column grid/flex container
   (`.decisions-two-pane`), each pane its own `overflow-y: auto` scroll box with `min-height: 0` on
   the scrolling children (the standard flex/grid scroll-containment gotcha), and a
   `@media (max-width: 768px)` rule collapsing to a single column (list stacked above detail, natural
   page scroll) — CSS-only, no JS viewport branching, matching the archived precedent's breakpoint.
4. **`App.tsx`**: `DecisionsSection`'s body is rewritten to compute `open`/`decided` (unchanged
   logic), call `useSelectedDecisionId()`, compute an `effectiveId` (see fallback below), render
   `DecisionListPane` in the left pane, and render `<DecisionView item={selected} onDecided={reload}
   />` (or an empty-state message) in the right pane. `DecisionView` itself is untouched.

**Selection default / fallback (applies uniformly to "no `?selected=`" and "`?selected=` names an id
not in the fetched set"):** fall back to the first open decision, else the first decided decision,
else render an explicit "Select a decision to see its details" empty state — never a blank pane or a
crash. This default is *not* written back to the URL; the URL only changes on an explicit row click,
so a bare page load doesn't mutate history/URL out from under the user.

**Persisting selection across `reload()`:** `DecisionView`'s own `onDecided` already calls `reload()`
after a verdict is recorded. Because `effectiveId` is recomputed from the current `selectedId` state
(untouched by `reload`) against the freshly-fetched `decisions` array on every render, the same item
stays selected across a reload — its `decided_at` just flips from null to a timestamp in place.

## Risks

- **Layout math for independent scroll.** Getting two truly independently-scrolling panes right
  depends on a bounded-height container coordinated with the existing app shell's nav/header CSS;
  easy to get a double scrollbar or a pane that doesn't scroll at all. Mitigation: standard
  flex/grid `min-height: 0` pattern, and a visual check in the running app — not just unit tests.
- **jsdom doesn't evaluate CSS media queries.** The narrow-viewport acceptance criterion is verified
  at the CSS-source level (the stylesheet contains the expected `@media (max-width: 768px)` rule),
  not via a rendered-layout assertion. Genuine responsive behavior should still be spot-checked in a
  real browser as part of review.
- **Scope drift risk on "reuse DecisionCard."** Flagged and resolved above — worth restating as a
  risk because it's the one place this plan diverges from the task's literal wording, based on what
  the current codebase actually contains.

## Open questions

None blocking. The one real judgment call (what renders in the detail pane, `DecisionView` vs.
`DecisionCard`) is resolved above with rationale rather than left open.
