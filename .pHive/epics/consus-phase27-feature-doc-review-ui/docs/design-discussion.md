# Design Discussion: consus-phase27-feature-doc-review-ui

## 0. Prelude

No `.pHive/CONTEXT.md` or prior KG decisions were queried for this run
(hand-planned in-session, mirroring consus-phase26's approach). Grounded in
a real, read-only research pass over the current codebase and a live query
of `.pHive/consus.sqlite` — every fact below is confirmed, not assumed.

## 1. Goal

Consus currently shows docs as one long flat list: `repo → phase →
<doc rows>`, with the doc's `epic` field shown only as a small inline
badge per row (`web/src/features/docs/DocBrowser.tsx`, confirmed 35 lines
total, no click-through grouping). With 201 real docs across 79 distinct
(repo, epic) pairs on this operator's own registered projects (confirmed
via a live count against `.pHive/consus.sqlite`'s `doc_index` table this
session), that flat list is the real, current pain point named in the
request — "when we get hundreds of these docs."

Restructure the UI around two real, distinct groupings:

1. **Per-FEATURE** (= per-epic, using the `doc_index.epic` column Consus
   already populates) — click a feature, see every doc that belongs to it
   together, and approve / deny / request-a-change on each, with that
   decision firing back through the mechanism that already exists for
   diagrams and events.
2. **Per-OVERALL** (repo-level meta: README, `VISION.md`, root `docs/*.md`)
   — confirmed this session that these are **not scanned at all today**
   (`SCAN_ROOTS = [".pHive/planning", ".pHive/epics"]`,
   `server/adapters/doc-scanner/index.ts:21`). This is a real gap, not a
   grouping problem — repo-meta docs currently have no path into
   `doc_index` whatsoever.

## 2. What Already Exists (do not rebuild)

Confirmed by direct research this session — this epic reuses these, it
does not reinvent them:

- **`doc_index.epic` / `doc_index.phase`** (`server/db/migrate.ts:47-56`)
  — every doc is already tagged via `deriveEpicAndPhase()`
  (`server/adapters/doc-scanner/index.ts:43-51`). Grouping by feature is
  therefore mostly a UI reshape of data that already exists, not a new
  data model.
- **The propose/approve/deny mechanism itself.** `POST /api/proposals`
  (`server/routes/proposals.ts`) plus the `proposals` table
  (`status CHECK IN ('pending','applied','failed')`) is a real, generic,
  working fire-to-harness flow, already wired end-to-end for diagrams
  (`ArchitectureDiagramView`, `App.tsx:630-703`) and events
  (`EventProposeComposer`, `App.tsx:1173-1194`). Docs already get an
  `items` row on open via `docItemIdFor` (`server/routes/docs.ts:102-108`)
  — the row exists, nothing acts on it. `App.tsx:782`'s own code comment
  states it plainly: the per-project docs section is **"Read-only here
  (no propose-change wiring)."** This epic wires docs into the SAME
  mechanism diagrams/events already prove works — not a new one.

## 3. Real Gaps Found This Session

1. **Repo-meta docs are entirely unscanned.** `README.md`, `VISION.md`,
   root `docs/*.md` never enter `doc_index` — there is currently no way
   to browse them in Consus at all, let alone group them as "Overall."
2. **Docs have no propose/approve/deny UI**, despite the backend item
   already existing per-doc and the exact same mechanism already proven
   live for two other target types.
3. **No trustworthy per-feature completion signal exists.** Checked this
   session: `.pHive/epics/*/stories/*.yaml`'s `status:` field is written
   once at plan time and never updated — confirmed live that even
   `consus-phase25-project-registration-ux`, already merged to `main` via
   PR #119, still shows `status: pending` on every one of its unit files.
   This is not a live signal Consus's product surface can honestly
   surface as "100% implemented." Per the operator's own explicit
   fallback in the request ("if we don't have that, we can move the
   status stuff elsewhere"), this epic does NOT build a feature-completion
   UI on top of that stale field. See §6 for the one honest alternative
   considered.
4. **Orphaned repo data.** Live query found 76 docs / 29 epics tagged
   `repo = "Portunus"` sitting in `doc_index` even though `"Portunus"` is
   not present in the current `.pHive/consus-projects.json` registry
   (only `consus`, `heimdall`, `mnemosyne` are registered). This is
   leftover data from some earlier scan, now orphaned. Not the epic's
   original ask, but a real data-hygiene bug found while grounding this
   design — worth one small story so the new per-feature view doesn't
   silently surface dead, unreachable "features" from a deregistered repo.

## 4. Proposed Approach

### 4.1 Scan repo-meta docs (closes gap 1)

Extend `doc-scanner`'s `SCAN_ROOTS` to also walk each registered repo's
root-level `README.md`, `VISION.md`, and `docs/**/*.md`, tagging them via
a distinguishable bucket — `phase: "overview"` (a new, reserved phase
value distinct from existing `"planning"`/epic-phase values) with
`epic: null`. This makes "Overall" a real, queryable bucket
(`WHERE phase = 'overview'`) rather than an ad-hoc UI-side filter.

### 4.2 Feature-grouped read API

New `GET /api/docs/features?project=<repo>` reshapes the existing
`doc_index` query into `{ features: [{epic, docCount, docs: [...]}],
overview: [...] }` — a server-side regroup of data `GET /api/docs`
already returns, not a new data source.

### 4.3 FeatureBrowser UI (replaces the flat `DocBrowser`)

Two-level navigation: a feature list (one row per epic, doc count shown)
plus a separate "Overview" section for the repo-meta bucket from §4.1;
clicking a feature opens a detail view showing every doc belonging to
that epic together (design-discussion, epic index, per-unit specs,
grill-record, etc. — whatever `doc_index` already has for that epic,
unchanged file set, just grouped).

### 4.4 Wire approve/deny/change into doc rendering (closes gap 2)

Extend the per-feature detail view's doc rendering with the same
propose/approve/deny controls `ArchitectureDiagramView` and
`EventProposeComposer` already use against `POST /api/proposals` — reusing
the existing `items` row each doc already gets via `docItemIdFor`. This is
the epic's central deliverable: the actual "review ALL the docs for that
feature and approve, deny, change, etc and fire that back" capability
named in the request.

### 4.5 Data hygiene (closes gap 4)

When a repo present in `doc_index` is no longer in the active project
registry, exclude it from the new feature view rather than silently
listing dead features pointing at nothing. A follow-up decision (not this
epic) is whether to actively prune `doc_index` rows for deregistered
repos or just leave them inert on disk — this epic only needs the view to
not surface them.

## 5. Non-Goals

- No change to how docs are scanned/parsed for `.pHive/epics/`
  content — only the SCAN_ROOTS extension in §4.1 is new scanning surface.
- No rebuild of the propose/approve/deny mechanism itself — reuse only.
- No feature-completion-percentage UI (see §6).

## 6. Open Question — Completion Status

The request allows explicitly for deferring this ("if we don't have that,
we can move the status stuff elsewhere"). Two real options exist, neither
built in this epic without a follow-up decision:

1. **Omit entirely** — the feature view shows docs only, no status pill.
   Simplest, fully honest given §3.3's finding.
2. **A coarser, honestly-derived signal** — e.g., "has this epic's
   `feat/<epic-id>` branch been merged into `dev`" via a real git check
   (Consus already has git-ref plumbing from consus-phase24's branch-level
   surfacing work) rather than trusting the stale YAML field. Not
   scoped into this epic's stories — flagged here as the one option worth
   a future, explicitly-scoped follow-up if the operator wants it.

## 7. Scale Assessment

**Medium.** One schema-light scanner extension, one reshaped read
endpoint, one UI restructure, and wiring an already-proven mechanism into
a new surface — no new backend primitive is invented.
