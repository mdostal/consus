# Consus — Vision

Consus is **the architect tool for any repo**: a local knowledgebase, graph, and file editor for a
repo's own decisions, docs, and architecture, plus a harness-agnostic Q&A/decision surface. Once a
repo's `.pHive/` planning tree is indexed, you should be able to easily open and interact with it —
that's the whole mission. It does not extend into being a ticket tracker, a CI dashboard, or a
dispatcher for other systems' work.

> **Provisional name.** "Consus" (Roman god of the granary / secret counsel) renames once it earns
> its keep — don't over-invest in the branding.

Consus went through a real architectural correction to get here: it briefly grew live integrations
with several other systems, and that coupling was fully stripped back out. That correction is now
a fixed boundary, not an open question (see below).

---

## ① Current — where it is now (v0.9.0)

Consus runs as a **Fastify server on `:8722`**, bound to `127.0.0.1` by default, backed by a local
**SQLite** file (`.pHive/consus.sqlite`), started with `npm run dev` (server + Vite web) or
`npm start` in production — the production server now serves the built web SPA itself
(`dist-web/`, via `@fastify/static`), not just the JSON API.

**What actually works (live and tested):**

- **HTTP API** — `GET /health`; `GET`/`POST /api/decisions` (read the open queue, now with
  `decision_type`/`triage_bucket` actually populated, or push a new decision/CBA in);
  `POST /api/items/:id/decide` and `POST /api/decisions/:id/verdict` (record a verdict,
  append-only audit log); `GET /api/items/:id/comments` + `POST` (comment threads);
  `GET /api/docs` + `/api/docs/content` (ref-aware, resolves across every configured repo) +
  `/api/docs/resolve` + `/api/docs/search`; `GET /api/projects` + `POST /api/projects/:project/ingest`
  + `POST /api/projects/scan-all`; KB routes including draft/submit separation and versioning;
  `POST /api/proposals` + `/result` (propose a change, fire it to a harness — shared by decisions,
  diagrams, and docs); `GET /api/diagrams` (epic/story cascade) + `/api/diagrams/:repo/architecture`
  (real per-repo directory-structure diagram); `GET /api/events` + `/history` + `PATCH .../status` +
  `POST .../propose` (the pre-decision review queue); `GET /api/items/:id/audit-trail`; artifact
  links. Full contract in [`docs/api-reference.md`](docs/api-reference.md).
- **Store** — idempotent SQLite migration; `items`, `audit_log`, `doc_index`, `kb_entries`,
  `kb_versions`, `proposals`, `events` with append-only versioning (a decided item never loses
  history).
- **Decision contract** — a `dostal:decision-request/v1` parser (options A–Z, tradeoffs, required
  `recommended`), tiered extraction (structured block vs. heuristic-from-prose, tagged via
  `extractionTier`), and a classifier that's actually wired into the write paths that populate it.
- **Doc scanner** — the only adapter in the codebase (`server/adapters/doc-scanner`); indexes a
  repo's own `.pHive/planning/` and `.pHive/epics/**`, resolving doc references across *every*
  configured repo, not just the one currently open.
- **Editable diagrams** — both the epic/story cascade and the architecture diagram are a real,
  direct-manipulation React Flow canvas: drag nodes, edit labels, add/remove nodes, connect or
  delete edges, with a structured changeset and a "Fire to harness" action reusing the same
  proposal mechanism as doc edits. A collapsible, derived (never independently-editable) Mermaid
  source preview sits alongside it.
- **A real visual system** — a manual light/dark/system theme control, and three switchable visual
  skins (Drafting Table, Case Board, Harness) — genuine per-skin decoration, not just recolored
  chrome. A universal `⌘K` command palette covers the keyboard-shortcut floor.
- **Multi-repo event pipeline** — scanning any project (single or `scan-all`) detects `doc_changed`
  and `decision_needed` triggers, each becoming a reviewable event (diff + composed prompt) with a
  manual status lifecycle, archived out of the active queue once resolved. An event can graduate
  into a real proposal on demand — the seam a future Pantheon L2 ticket-adapter would consume for
  automatic dispatch in paired mode, deliberately not built here.
- **Propose-a-change** — the sole write path into a repo's own content. A diff + description goes
  through the generic `HarnessTransport` (`server/harness/transport.ts`); a harness applies it and
  reports back. Defaults to a no-op unless a local command is configured.
- **Web SPA** — `web/src/App.tsx`: a per-project view showing a project's diagrams, docs, and KB
  entries together, a two-pane Decisions layout, an in-place doc editor with section-scoped diffs,
  and a first-run onboarding screen for a fresh install.

**Honest gaps right now:**

- **PR/branch-level surfacing is not started.** Most work-in-progress lives on feature branches
  before reaching `main`; surfacing a branch's or PR's own docs/CBA/decisions the way merged-to-main
  state is surfaced today is a real, explicitly deferred item — see the backlog's dedicated theme.
  **Do not scope this until explicitly asked.**
- **Interaction polish / accessibility pass** on the newer surfaces (the diagram editor, the skin
  system) is backlogged, not started.
- **Dual-mode integration tests** (standalone vs. a future Pantheon-plugin mode) are backlogged —
  worth revisiting once there's an actual second mode to test against; today's mainline has only
  ever run standalone.

---

## ② Goals — near-term next steps

The backlog is intentionally thin right now — most of what was tracked as a near-term gap shipped
in tonight's run (see `.pHive/planning/backlog.md` for the full, cited history). The one item kept
visible but explicitly *not* queued is PR/branch-level surfacing (above) — real, not forgotten, but
not to be scoped until the operator asks for it by name. Beyond that, near-term direction is
operator-driven rather than a standing queue; see **Good first contributions** below for concrete,
safe-to-pick-up work that doesn't require a new design decision first.

---

## ③ Long-term vision — where it grows to

**Consus becomes the whole index → open → interact → propose → shared-truth loop, fully
productized for any repo** — not just a screen that renders docs, but the tool that makes a
repo's own architecture legible and editable without digging through files by hand.

- **A shared-truth knowledge base.** Every approved decision, CBA, and doc becomes durable,
  versioned, searchable KB — grounding future decisions in what's already been decided.
- **PR/branch-level surfacing.** Extend today's merged-to-main view down to in-progress,
  cross-branch work, once there's real demand to scope it.
- **Cross-system integration stays out of Consus's own codebase.** If Consus ever needs to talk to
  another system, that integration lives one layer up (e.g. a future Pantheon L2 adapter) and
  reaches Consus over the same generic seams — `HarnessTransport`, plain REST — any other harness
  would use. Consus itself does not grow a client for any specific external system again.

### Fixed boundaries

These are settled, not open questions:

- **Standalone-only.** Zero live coupling to any specific external system — `server/adapters/`
  contains only `doc-scanner/`.
- **Harness interaction only through the generic seam.** `HarnessTransport` is the sole
  integration point for "propose a change and let something apply it," with no knowledge of what's
  configured on the other end.
- **Local-only by default.** `127.0.0.1` binding on both the Vite dev server and the Fastify
  server unless explicitly overridden. The production server reads `HOST` (default `127.0.0.1`)
  so a containerized deploy can bind `0.0.0.0` — nothing changes for anyone who doesn't set it.
  Not a network-exposure-by-default policy shift, just an explicit opt-in for a deliberate deploy.

---

## Good first contributions

- **Interaction polish / accessibility pass** on the diagram editor and the 3-skin visual system —
  a real backlogged item, not yet scoped into stories.
- **Decided-store reconciliation semantics**, if a concrete need for a "defer" concept (distinct
  from Consus's simple `decided_at` timestamp) ever comes up in practice — closed as not-needed for
  now per an explicit operator call, but the door isn't nailed shut if a real case appears.
- **Docs/tests** — extend `docs/api-reference.md` as routes land, and add tests for any newly-wired
  UI. Keep this doc's own claim ("a harness author should be able to use Consus from this doc
  alone") true as new routes ship — it drifted behind real code more than once already.

New here? Read [`.pHive/planning/vision-and-way-of-working.md`](.pHive/planning/vision-and-way-of-working.md)
and [`.pHive/planning/backlog.md`](.pHive/planning/backlog.md) for the fuller current-state picture,
then [`docs/api-reference.md`](docs/api-reference.md) for the HTTP contract. Land a test with your
change.
