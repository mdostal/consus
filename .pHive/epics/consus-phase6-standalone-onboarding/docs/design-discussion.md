# Design Discussion: consus-phase6-standalone-onboarding

## Goal

Make Consus usable, standalone, against its own repo, out of the box. Today a
fresh checkout shows empty tabs with no explanation and no path forward — the
data that would fill them (generated docs, architecture, PRDs, decisions)
exists on disk under `.pHive/` but nothing ever pulls it into Consus's own
SQLite store. This epic closes that gap with one deliberate, operator-triggered
action: "ingest this repo," plus a first-run screen that makes the action
discoverable instead of leaving the operator staring at blank tabs.

This is explicitly scoped to Consus's own fixed mission — a local
knowledgebase/graph/file editor for a repo's own decisions/docs/architecture,
plus a harness-agnostic Q&A surface. It does not add any new external-system
coupling. Cross-plugin integration (future Pantheon L2 adapters) is out of
scope here.

## Proposed Approach

Three small, sequential changes:

1. **Wire the existing scan function to an HTTP route.** `scanRepo()` in
   `server/adapters/doc-scanner/index.ts` already does the real work —
   it walks `.pHive/planning/` and `.pHive/epics/**` for `.md`/`.html`
   files and populates the `doc_index` table, idempotently (content-hash
   based, safe to call repeatedly). It is fully built and tested but never
   called outside its own test file. Add `POST /api/projects/:project/ingest`
   that resolves the project's repo path from the existing project registry
   (`server/config/project-registry.ts`, which already defaults to mapping
   `consus` to the current working directory with zero config) and calls
   `scanRepo()` against it, returning a count of docs indexed.

2. **Fold docs into the per-project view.** Consus already has a working
   per-project view (`ProjectsSection` in `web/src/App.tsx`, backed by
   `ProjectView` + `ProjectDiagram`/`DiagramView`) that shows KB entries and
   the epic/story diagram cascade together when a project is selected. Docs
   are stuck in a separate, unscoped "Docs" tab today. Add docs to that same
   per-project view, and put the "Ingest repo" button there — triggering
   the new route, then reloading.

3. **Add a first-run onboarding screen.** When there is nothing ingested
   anywhere yet (no docs, no KB entries, no decisions), replace the default
   blank Decisions-tab view with a short onboarding screen: an "Ingest repo"
   call to action (the same route from step 1), a pointer to the existing
   agent-facing skill doc (`skills/consus/SKILL.md`) under an "Install into
   harness" heading, and plain forward-looking copy for "Interact with
   plugin-hive." Nothing in this step is new backend functionality — it's
   copy and a wired button.

Diagrams already work with zero ingest step (`GET /api/diagrams` reads epic
YAML straight off disk on every call), and KB entries come from the existing
decision/approve flow, which is unaffected by this epic.

## Risks

- **Scan cost on large repos.** A synchronous scan on every ingest click
  could feel slow on a very large `.pHive/epics/` tree. Mitigation: not a
  concern at current scale (a handful of epics, dozens of files) — no async
  job queue needed for this pass. Revisit only if a future repo's `.pHive`
  tree grows large enough to make a synchronous scan noticeably slow.
- **Staleness after manual edits.** Ingest is on-demand, not a background
  poll — if planning docs change on disk after the last ingest, the operator
  won't see the update until they click ingest again. This is intentional
  (the operator explicitly rejected a background-sync model) but worth
  surfacing as a known tradeoff, not a bug.
- **Onboarding screen dependent on three empty checks.** Determining "nothing
  ingested yet" requires checking docs + KB entries + decisions are all empty.
  If any one of those checks is wrong, the onboarding screen could show when
  it shouldn't (or vice versa). Mitigation: keep the check simple and covered
  by a test in s3.

## Dependencies

None blocking. All three changes build on infrastructure that already exists
and is already tested (`scanRepo`, the project registry, the diagram/KB
per-project view).

## Open Questions

1. Should the "Ingest repo" button in the per-project view (s2) and the one
   on the first-run screen (s3) be the exact same component, or two separate
   call sites hitting the same endpoint? (Recommendation: two call sites is
   fine for this pass — they're simple fetch-and-reload buttons; a shared
   component would be premature abstraction for two usages.)
2. Should ingest also run automatically once, silently, the very first time
   the server boots against an empty `doc_index` — or should it always
   require an explicit click, even on a totally fresh install? (Current
   design assumes always-explicit, matching the operator's stated
   preference for a deliberate, operator-triggered action over any
   automatic behavior.)
3. Is "no KB entries + no docs + no decisions" the right bar for showing the
   onboarding screen, or should it disappear as soon as ANY one of the three
   has data (so a repo with only diagrams populated still sees onboarding
   for the rest)? (Current design: disappears once ingest has been run at
   least once, tracked simply by "docs is non-empty," since docs are the
   one thing only ingest can populate — diagrams need no ingest and KB
   entries come from a different flow entirely.)

## Scale Assessment

**Medium** (cross-stack: one new backend route plus two frontend view
changes) but a thin slice — three files touched in total, one new HTTP
endpoint, no new persistence beyond the `doc_index` table that already
exists and is already populated by the existing (just newly-wired) scan
function. No new dependencies, no schema changes, no new adapters.
