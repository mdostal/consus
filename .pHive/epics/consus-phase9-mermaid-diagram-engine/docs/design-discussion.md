# Design discussion: Mermaid diagram engine

## Goal

Consus's diagram view (`web/src/features/projects/DiagramView.tsx`) shows a
repo's epic/story dependency cascade — today rendered as plain nested `<ul>`
lists (epic -> stories -> "depends on X, Y"). That's an explicit, documented
deferral: `.pHive/planning/architecture.md` decision #3 defers a "DAG/diagram
engine" to a future phase, and `DiagramView.tsx`'s own source comment repeats
this ("Nested-list rendering by design ... a graphical DAG/diagram engine is
explicitly deferred, not this story's scope"). `.pHive/planning/backlog.md`
tracks the deferred capability explicitly: "Visual diagram engine ... vs.
mainline's current plain nested-list `DiagramView` | `backlogged`". This epic
picks that backlog item up: render the same cascade as an actual graphical
diagram, without touching anything else about how the view works.

## What the archived version actually built

`archive/dev-2026-08-11-pantheon-coupled` built this once already, as two
separate components under `web/src/components/` (not `features/projects/`):

- **`DiagramView.tsx`** (~275 lines): fetches pre-built Mermaid source text
  from the server (`/api/diagrams/:repo` or `/api/diagrams/cascade`), then
  renders it client-side via the real `mermaid` npm package
  (`^11.16.1`, confirmed in that branch's `package.json`) — `mermaid.render(id,
  source)` returns `{ svg, bindFunctions }`; the component sets
  `container.innerHTML = svg` and calls `bindFunctions?.(container)`. It has a
  Top/Full toggle for repo-architecture mode and shows a skeleton loader while
  fetching/rendering.
- **`DiagramViewer.tsx`** (~203 lines): a more polished variant — dynamically
  `import("mermaid")` (code-split), a 5-second render timeout via
  `Promise.race` with a friendly "too complex to render quickly" message,
  tab switching between "Repository" and "Cascade" modes, and
  `securityLevel: "strict"` on `mermaid.initialize`.

Both are genuine Mermaid.js rendering — not hand-rolled SVG/positioning.
Neither component wires node clicks to anything: `bindFunctions?.(container)`
only activates interactivity that the Mermaid *source itself* declares (e.g.
`click nodeId callback` directives), and neither server-side generator
(`server/lib/diagram-generator.ts` for repo-architecture graphs,
`server/lib/cascade-tree-builder.ts`'s `renderCascadeMermaid` for the
cascade) ever emits a `click` directive. So there is no click-to-detail
interaction to port, and — confirmed by reading `cascade-tree-builder.ts` —
no Minerva/Multica coupling inside the rendering components themselves. The
coupling lives one layer up, in `server/routes/diagrams.ts`'s `/api/diagrams/
cascade` handler, which calls `buildCascadeTree({ client: MulticaClient,
repos })` to fetch live issues before rendering. That fetch-and-classify
logic is what we are **not** porting. The Mermaid-string-building mechanics
inside `renderCascadeMermaid` (sanitize a node id, escape a label, declare
node lines, then edge lines, as `graph LR`) are simple, self-contained, and
not Multica-specific — worth re-deriving directly against local data rather
than importing the file, since half of what it does (Multica issue
classification) doesn't apply here.

## The decoupled approach for mainline

`GET /api/diagrams?repo=X` (`server/routes/diagrams.ts`, current mainline)
already returns everything this needs: `{ repo, itemId, epics: [{ id, title,
stories: [{ id, title, complexity, dependsOn }] }] }`, built entirely from
this repo's own `.pHive/epics/*/epic.yaml` on disk. No backend change is
required — the plan is client-side only:

1. In `DiagramView.tsx`, build a Mermaid `graph TD` (or `LR`) source string
   from the `epics` prop already passed in (one subgraph per epic, one node
   per story, edges for `dependsOn`), reusing simple id-sanitizing/label-
   escaping helpers in the same spirit as the archived `sanitizeMermaidId`/
   `escapeMermaidLabel` but written fresh against local types.
2. Render that string via `mermaid.render()` into a container `div`, replacing
   the nested `<ul>` markup. Keep everything else in the component — the
   header, the "Propose a change" form (`onProposeChange`), the
   `pendingProposal` pill, and the `AuditPanel` history section — exactly as
   is. This is additive to the render, not a rewrite of the component's data
   flow or props.
3. Add `mermaid` as a new dependency. Confirmed: mainline's root
   `package.json` (single package.json, no separate `web/package.json`) has
   no `mermaid` entry under `dependencies` today — this is a genuinely new
   addition, not a version bump. `^11.16.1` (the version the archived branch
   used) is a reasonable pin.

Note on prior art: `architecture.md` decision #3 names *React Flow* as "the
prior CBA's ... recommendation" for the eventual diagram engine, not Mermaid.
The archived branch built Mermaid instead. This plan follows the archived
branch's working, already-tested Mermaid approach over the older React Flow
recommendation, since it's the only implementation that actually exists —
flagged as an open question below rather than silently overridden.

## Risks

- **Bundle size**: `mermaid` is a large dependency (it bundles its own d3
  and layout engine). It should be dynamically imported (`await
  import("mermaid")`, as `DiagramViewer.tsx` did) rather than statically
  imported at the top of the module, so it's code-split into a chunk only
  loaded when a diagram view actually mounts.
- **Browser-only rendering quirks**: `mermaid.render()` runs against a real
  DOM and can throw or hang on malformed/cyclic graph text. The archived
  `DiagramViewer.tsx`'s render-timeout-with-fallback-message pattern (race
  against a 5s timeout) is worth keeping so a bad render doesn't hang the
  view indefinitely.
- **Large cascades**: a repo with many epics/stories could produce a large,
  visually dense graph. No node cap is proposed here (data volumes are small
  in practice — single-digit epics, low tens of stories per repo currently),
  but worth a follow-up guard if that changes.
- **Test environment**: `mermaid.render()` doesn't run meaningfully under
  jsdom/vitest; the archived test suite mocked the whole `mermaid` module
  (`vi.mock("mermaid", ...)`) rather than exercising real rendering. The same
  approach applies here.

## Open questions

1. React Flow (`architecture.md`'s original recommendation) vs. Mermaid (the
   only implementation that actually exists, from the archived branch) — this
   plan follows the archived Mermaid approach as the pragmatic choice, but
   that's a deviation from the documented CBA recommendation worth a
   deliberate sign-off rather than a silent override.
2. Layout direction (`graph TD` top-down vs `graph LR` left-right) for the
   epic/story cascade — the archived cascade builder used `LR`; worth
   confirming that reads well once real multi-epic dependency data is on
   screen, rather than assuming.

## Scale assessment

**Small/medium.** Rendering + interaction only, confined to
`web/src/features/projects/DiagramView.tsx` and one new dependency in
`package.json`. No new backend routes, no new DB tables, no change to the
existing propose-a-change dispatch path or `GET /api/diagrams` response
shape. The only genuinely new capability is client-side Mermaid-source
generation from data the view already receives, plus wiring the `mermaid`
package to render it.
