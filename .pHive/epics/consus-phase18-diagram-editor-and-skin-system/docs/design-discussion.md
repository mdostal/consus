# Design Discussion: consus-phase18-diagram-editor-and-skin-system

## Goal

Today Consus's diagrams (the epic/story dependency cascade and the new per-repo architecture
diagram, both `GET`-only, rendered read-only via Mermaid) can't be edited — an operator can only
look. This epic adds real, direct diagram editing (move/add/remove nodes, edit labels, edit
connections) that produces a diffable change firing through the existing `POST /api/proposals`
mechanism, exactly mirroring how the doc editor already works. Alongside that, this is a **total
UI/UX pass**: three genuinely distinct visual directions were explored in parallel and none of
them is being picked over the others — all three ship as **switchable skins** over one shared
interaction model, plus a first-ever manual light/dark theme control (a real gap found during this
pass — see below).

## How we got here

Per the operator's own described playbook: three independent, blind design agents (general-purpose,
not fork — forks inherit context/bias, defeating the point) were each given the same structural
brief (real Consus data: actual epics shipped this session, a real backlog excerpt, the
decision-request/v1 shape) plus one orthogonal creative direction, and told to load the
`artifact-design` skill and produce one self-contained HTML mockup each, blind to each other's
output. In parallel, a fourth agent ran a real cost-benefit analysis (live npm/Bundlephobia data,
real license research) on which library should power the editing itself.

Every mockup was rendered and screenshotted independently (not just trusted from each agent's own
self-report) before being shown to the operator. That verification caught one real bug — in the
terminal-direction mockup, diagram nodes overlap and truncate mid-label once a diagram has 6+
sibling nodes (`server/decision-contra`, `server/li` cut off and overlapping the next box) — and
ruled out a second apparent bug (mojibake arrows/dots) as a false positive from the verifier's own
ad hoc local test server missing a charset header, not a real defect in the file.

All three mockups were published unfiltered — no pre-selection — and the operator's own synthesis
across all three, not a single picked "winner," is what this document turns into a spec.

## Current-state findings

- `server/routes/diagrams.ts` — `GET /api/diagrams` (epic/story cascade) and
  `GET /api/diagrams/:repo/architecture` (directory-structure diagram) are both read-only. Neither
  changes in this epic — this is additive editing capability, not a rewrite of either endpoint.
- `web/src/features/projects/DiagramView.tsx` and `ArchitectureDiagramView.tsx` — the two current
  read-only Mermaid renderers. Both get replaced as the primary editing surface (see React Flow
  decision below); Mermaid rendering itself is not removed from the codebase, since the collapsible
  source panel (below) still needs to show/preview Mermaid-shaped text.
- `web/src/App.tsx`'s `DecisionsSection`/`DecisionView` (consus-phase16, shipped this session) — the
  two-pane Decisions layout is recent and correct; this epic's decision-card treatment in the
  mockups matches it, no rework needed there beyond normal skin styling.
- The doc editor (consus-phase12, `sectional-diff-view`) already does **section-scoped, sectional**
  diffing in production — split at markdown heading boundaries. One of the three mockups (the
  terminal direction) matched this; another (the blueprint direction) used a different, word-level
  LCS diff. **Resolved: keep the existing sectional model.** Introducing a second, word-level diff
  mechanism alongside the one already shipped would be inconsistent for no real benefit — the
  mockup's word-level diff was a plausible design candidate, not evidence the shipped approach needs
  replacing.
- **Real gap found while researching this epic: Consus has no manual light/dark control today.**
  `web/src/theme/tokens.css` is `:root` (light) + a bare `@media (prefers-color-scheme: dark)`
  override — no `[data-theme]` attribute, no toggle UI, no persistence anywhere in `web/src/`
  (confirmed: zero `localStorage` usage in the whole `web/src` tree). One of the three mockups
  (case-board) invented its own light/dark/system cycle control that doesn't exist in the real app.
  Since this epic is already touching the theming system to add a *skin* axis, it also adds the
  first real manual *theme* (light/dark/system) control — building a skin-picker with nothing for it
  to sit next to would be an inconsistent, half-finished UI moment. Small, natural, in-scope addition.
- `mermaid` (`^11.16.1`) is the only diagramming dependency (`package.json`). No router library
  exists (confirmed: no `react-router-dom`, no `<Route>`/`<BrowserRouter>` in `App.tsx`).

## Resolved design decisions

Every item below was an explicit operator call across this conversation — treat these as settled,
not as design latitude for the implementer to reinterpret.

1. **All three explored directions ship as real, switchable skins** — not one picked winner, not a
   "default + one alternate." A **skin picker** (Drafting Table / Case Board / Harness) sits
   alongside the new theme picker (light/dark/system).
2. **Skin is orthogonal to theme.** Skin = decorative identity (grid-paper + title-block vs.
   cork-texture + pushpins/string vs. terminal/monospace chrome). Theme = light/dark. Every skin
   must render correctly in both themes — this is the same discipline the existing
   `--consus-*` token system already requires for light/dark, now doubled across three skins × two
   themes = six real combinations to actually check, not assume.
3. **One shared layout skeleton for all three skins**, not three different information
   architectures. Concretely: left nav, header, a diagram-type switcher (cascade vs. architecture)
   with a per-diagram **dirty-state dot** *and* a global "N pending changes" count in a **persistent
   right-rail changeset panel** (this was Harness's fire-time diff drawer in the mockup; the
   operator's call was to fold that structured content into the right rail as an ongoing panel, not
   keep it as a separate modal/drawer). The right rail's content model is **structured, typed rows**
   (added / removed / changed / moved — moved gets its own distinct color, since a text-based
   diagram format has no notion of node position and a pure move is a materially different kind of
   change from a structural edit) — not a flat list of freeform log lines. Skins may reflavor the
   verb vocabulary in that log (e.g. "Pinned"/"Connected" vs. a plain "Added"/"Connected"), but the
   underlying event types and the "Fire to harness" action label itself are constant across skins.
4. **A collapsible raw Mermaid source panel, available in every skin**, not just the terminal one —
   this was called out explicitly as a must-have for developer users. **Resolved as a derived,
   read-only-by-default preview** of the live node/edge editing state (regenerated from the graph on
   every change), not a second independently-editable surface — a text box that could diverge from
   the visual graph would reintroduce exactly the "two diagram engines to keep in sync" risk flagged
   in the library CBA. If a later story wants text-editing of the source directly, that is new scope
   requiring its own explicit decision about how a hand-edited text change reconciles back into
   node/edge state — not assumed here.
5. **Edge deletion supports both interaction paths found across the mockups**: click a connector
   directly to snip it (discoverable, from the case-board mockup), and multi-select + a
   "Delete selected" action (from the blueprint mockup) for bulk cleanup. Not an either/or.
6. **Node dragging is handle-only** (grab a dedicated drag affordance — a pin/handle — rather than
   the whole node body), so a click-to-edit-label gesture and a drag-to-move gesture can never be
   ambiguous. Operator's own framing: this is a "focused point" — the exact hit-target size/shape is
   left to be tuned during building/review, not pre-specified pixel-for-pixel here.
7. **A command palette (⌘K) with real keyboard shortcuts is universal across all three skins** —
   explicitly not terminal-skin decoration; this is a developer-productivity feature the operator
   asked for by name ("100% ... we'll need quick keys"). Minimum shortcut set: open palette (⌘K),
   switch diagram tab (number keys, matching the terminal mockup's own precedent), toggle the source
   panel, fire to harness. More can be added during implementation; this set is the floor, not the
   ceiling.
8. **Per-skin edge rendering differs by curve style, not just color**: Case Board renders edges as
   organic, sagging "string" curves; Drafting Table and Harness render precise straight/orthogonal
   lines. React Flow supports custom edge types natively, so this is a real, direct implementation
   path (an `edgeType` resolved from the active skin), not a hack.
9. **A shared diagram-metadata strip** (revision count, operator, date) is one real component,
   reskinned per direction — Drafting Table's title block (with its REV field incrementing on every
   successful fire, a genuinely nice per-skin touch worth keeping), Case Board's "CASE NO." stamp,
   and Harness's footer status line are three skins of the same underlying data, not three unrelated
   pieces of chrome to build separately.

## Library decision

**React Flow (`@xyflow/react`)**, per the parallel CBA (published alongside this exploration):
MIT-licensed, 59.8 kB gzip (smaller than either Mermaid-internal chunk already shipping), React
18-compatible, and its native `{nodes, edges}` state maps directly onto both diagram shapes
(a dependency tree and a directory graph are both, structurally, graphs) without forcing either into
a foreign representation. The CBA's own honest counter-argument stands and is worth restating: this
is real new integration surface (a bidirectional mapping to/from the existing `DiagramEpic[]` /
`{topLevel, fullComponent}` API response shapes, plus a diff formatter that turns node/edge state
into the existing generic `diff: string` field `POST /api/proposals` expects) — accepted as the
right tradeoff for genuine editing (including node movement, which a text-only approach structurally
cannot express), not a free upgrade.

## Vertical slice plan

Five stories, each leaving the product in a real, working, demoable state — later stories depend on
earlier ones but nothing here is a "big bang" all-or-nothing cutover.

1. **s1-theme-and-skin-token-system** — the foundation. Adds the first-ever manual light/dark/system
   theme control (new, real gap) *and* a second, orthogonal skin axis (`data-skin` attribute,
   analogous to `data-theme`) with three real token sets + a picker UI for both, placed together.
   Ships against the *current* read-only diagram views and doc editor first — i.e., the whole app
   visually re-skins correctly in all three directions × both themes before any editing capability
   is added. This is deliberately sequenced first because it's the highest-leverage regression risk
   (six real combinations across the entire app) and is far cheaper to get right before the editor
   built on top of it exists.
2. **s2-react-flow-diagram-editor-core** — swaps the read-only Mermaid canvas for an editable React
   Flow canvas for both diagram kinds: drag-by-handle, click-to-edit label, add/remove node, connect
   nodes, both edge-deletion paths (click-to-snip and multi-select+delete), per-skin edge curve
   style. The structured right-rail changeset panel (typed rows, per-tab dirty dot + global count)
   and a real "Fire to harness" wired to `POST /api/proposals` (a real diff-formatter turning
   node/edge change state into the generic `diff` field) ship in this story — this is the big core
   slice and the one most worth extra review time.
3. **s3-collapsible-mermaid-source-panel** — the derived, read-only-by-default Mermaid source
   preview, toggleable in every skin, regenerated live from the same node/edge state s2 edits.
4. **s4-command-palette-and-shortcuts** — ⌘K palette + the shortcut floor listed above, universal
   across skins, built against the now-real editor from s2/s3.
5. **s5-shared-metadata-strip-and-skin-polish** — the one shared diagram-metadata component
   (REV-on-fire / case-no. / status-line skins), plus a final pass reconciling any remaining
   skin-specific decorative details found during s1-s4 (title-block hatching, cork-texture canvas
   draw, terminal chrome) that didn't already land as part of s1's token work.

## Risks

- **Six real skin×theme combinations, not one.** Every visual review (this epic's own, and any
  future one touching these views) needs to actually check across all six, not assume dark-mode
  parity from a light-mode check the way a single-theme app could get away with. Mitigation: s1
  ships and is reviewed *before* the editor is built on top, deliberately front-loading this risk.
- **React Flow integration is real, non-trivial engineering**, not a drop-in swap — the CBA's own
  honest counter-argument (a second diagram representation to maintain, a diff formatter to write).
  Mitigation: accepted tradeoff, already made explicitly with the operator; s2 is scoped as its own
  full story with extra review weight rather than folded into s1.
- **The Harness mockup's real bug (node overlap/truncation at 6+ siblings)** must not carry into the
  real build. React Flow's own layout (unlike hand-rolled SVG positioning in the mockup) has
  different sizing behavior, but s2's acceptance criteria must explicitly test a diagram with 6+
  sibling nodes as a regression guard, not assume the library alone fixes it.
- **Node drag-vs-click disambiguation (decision 6) is intentionally left as a "focused point."**
  s2's acceptance criteria should cover the *behavior* (click edits, drag-by-handle moves, the two
  are never ambiguous) without over-specifying exact hit-target geometry, so the implementer has
  real room to tune it during building — per the operator's own framing.

## Open questions

None outstanding — every design fork surfaced during the three-mockup exploration was explicitly
resolved by the operator across this conversation (see "Resolved design decisions" above). If a new
ambiguous call comes up during s1-s5 execution that isn't covered above, stop and ask rather than
guessing — same standing practice as every other epic this session.
