# Changelog

## [Unreleased]

### Added

- **Register a new project from the API/UI** (`POST /api/projects`, an `AddProjectForm` in the
  Projects tab): names a project, points it at a repo path on disk, persists it to
  `.pHive/consus-projects.json`, and runs an immediate scan.
- **`consus-phase25-project-registration-ux`:** three real gaps found by live-testing the above —
  selecting a project surfaced no way to see where it actually lives on disk, the add-project
  button was completely unstyled (zero CSS rule targeted it), and there was no way to find a repo
  to register beyond typing its exact absolute path from memory. Fixed via a fully planned +
  executed epic (`/plan` → adversarial `/grill` → `/execute`, 5 dependency-tracked stories):
  `GET /api/projects` now returns each project's `paths`, shown as a labeled `Project path` field
  when selected; the add-project submit button now matches the app's existing accent-fill
  convention (`.diagram-view__header button`) across all 3 skins; a new
  `GET /api/fs/list?path=` (generic, loopback-only, one-level directory listing) backs both a
  zero-config `GET /api/projects/discover` (auto-surfaces sibling repos of already-registered
  projects, plus an optional `CONSUS_DISCOVERY_ROOTS` env var) and a new interactive
  `DirectoryBrowser` component — navigate from the home directory, breadcrumb back up, select any
  directory regardless of whether it's repo-flagged. All three path-filling methods (manual entry,
  discovered-candidates select, browser) are additive; none is a hard requirement.
- **`Consus.app` — a native macOS desktop shell** (`consus-phase26-desktop-app`, 6 dependency-tracked
  stories, planned and built by directly reading Heimdall's real, shipped `app/src-tauri/`
  implementation and adapting it, not reinventing it): a Tauri v2 app that spawns Consus's own
  compiled server as a background sidecar (spawn/health-check-via-`GET /health`/idempotent kill
  across every quit path, login-shell `PATH` capture, an OS-assigned free port), a menu-bar tray
  (Open Consus / Check for Updates… / Launch at Login / Quit), a single-instance guard so a second
  launch focuses the existing window instead of colliding on the shared app-local sqlite file,
  close-to-tray window behavior, a minimal app icon set, a real `cargo tauri build` release
  packaging pipeline that stages both `dist-server/` and `dist-web/` into the bundle (the one place
  Consus's real two-artifact build genuinely diverges from Heimdall's single-artifact one), and a
  background update checker against this repo's own GitHub releases. Runs with its own fresh,
  empty state under `~/Library/Application Support/com.mdostal.consus/` — never the operator's live
  decisions data — so the operator registers projects themselves on first launch.

### Changed

- **`consus-phase26-desktop-app` release finalization.** Applied the epic's planned `minor` version
  bump (`0.12.0` → `0.13.0`) and kept `package.json`, `app/src-tauri/tauri.conf.json`, and
  `app/src-tauri/Cargo.toml` in lockstep.

## [0.12.0] - 2026-08-19

### Added

- **OSS release readiness:** LICENSE (MIT) + full `package.json` metadata (license/author/repository/homepage/bugs); CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md.
- **`consus-phase23-decision-attachments`:** file attachments on decision items — attach a screenshot, PDF, or exported doc directly to a decision. `POST/GET /api/items/:id/attachments`, `GET/DELETE /api/attachments/:id`, local-disk storage under `.pHive/attachments/` (override via `CONSUS_ATTACHMENTS_DIR`). Drag-drop/file-picker upload, list with previews, delete gated behind a real confirmation step — all wired into the decision detail view. Ported and adapted from a complete, standalone-compatible capability found on a stale pre-strip branch (`feat/PAN-7819`) that was never merged before the Multica/Minerva coupling strip — re-derived against this build's current schema/conventions, not cherry-picked.
- **`consus-phase24-branch-level-surfacing`:** branch-level decision surfacing and doc-diff-vs-main, git-local only (no GitHub API, no auto-fetch — zero new external coupling). A branch picker in the Projects tab scopes the decisions list to a feature branch's own open decisions (`GET /api/decisions?branch=`, `POST /api/projects/:project/ingest?ref=`); an inline "view diff" action shows what a doc actually changed relative to the project's real default branch (`GET /api/docs/diff`, default branch resolved from `origin/HEAD`, never hardcoded to `main`). New `server/adapters/doc-scanner/git-ref.ts` shells out to `git` via `execFileSync` with argument arrays only.

### Fixed

- Scrubbed a personal Tailscale IP + SSH username committed across 7 planning/docs files; deleted an orphaned, un-stripped duplicate `docs/VISION.md` still describing live pre-strip coupling; fixed stale v0.9.0 version markers and a factually wrong `docs/api-reference.md` claim that `decision_type`/`triage_bucket` weren't wired into any route.
- **Security (found via a post-ship adversarial review of the two features above):** a pre-existing path-traversal gap in `GET /api/docs/content` (no boundary check on the requested path — could read arbitrary files outside the repo) is now closed; the client-supplied attachment `Content-Type` was stored and replayed verbatim, letting a spoofed multipart type on an otherwise-allowlisted file execute as stored XSS when its raw download URL was opened directly — the served type is now always derived server-side from the file's extension, non-image types are forced to download rather than render inline, and `X-Content-Type-Options: nosniff` is set on every attachment response; deleting an attachment now actually frees its file from disk (the storage layer's own delete function existed and was tested, but was never called from the route).

## [0.11.0] - 2026-08-18

### Added

- **`consus-phase21-codex-cli-support`:** `npm run agent:init`/`agent:status` now also install Consus's agent-facing skill to Codex CLI (`$CODEX_HOME/skills/consus/SKILL.md`, defaulting to `~/.codex/skills/consus/SKILL.md`), alongside the existing Claude Code support — a real, primary-source-confirmed mechanism (Codex's own bundled `skill-installer` skill documents this exact convention), not guessed at. A new `--harness claude`/`--harness codex` flag narrows a run to one harness; the other is genuinely never even read when narrowed, not just skipped for writing.

### Fixed

- **`consus-phase20-diagram-editor-a11y`:** three real, verified accessibility findings from a hands-on audit of the diagram editor and command palette. The diagram editor's node move and edge delete are now keyboard-accessible (arrow keys on a focused node, Enter/Space on a focused edge — both reusing the exact same change-producing logic the pointer paths already use). The command palette's focus trap is now genuine — `role="dialog" aria-modal="true"` previously implemented no real containment (live-reproduced: Tab escaped to an unrelated page element); it now traps Tab/Shift+Tab with full wrap and restores focus to whatever actually had it before opening. The Harness skin's terminal cursor blink now respects `prefers-reduced-motion` (a static, still-visible cursor instead of an unconditional infinite blink).

## [0.10.0] - 2026-08-18

### Added

- **`consus-phase19-agent-harness-onboarding`:** `npm run agent:init`/`agent:status` — a real install action for Consus's agent-facing skill, dropping `skills/consus/SKILL.md` into `~/.claude/skills/consus/SKILL.md` (Claude Code's real skill-discovery location) so any Claude Code session on the machine can use it, regardless of which repo it's running from. Idempotent (a real byte-level content comparison, not existence/mtime), never creates `~/.claude/` itself if absent, reports three distinct outcomes (installed / already up to date / updated). A new `HarnessConnectBanner` in the app shell surfaces this prominently on every tab, collapsible to a small reopenable affordance whose state persists across reloads. Scoped to Claude Code only for v1.

### Fixed

- **The production server now serves its own built dashboard.** `GET /` was previously a bare 404 — no static-file-serving route existed anywhere, so only the JSON API was reachable in production; every shipped frontend feature was unreachable through the actual server. Fixes #105.

### Changed

- README, VISION, `docs/api-reference.md`, and `skills/consus/SKILL.md` brought current with real v0.9.0 capability — all had drifted behind real shipped code (stale read-only-diagram framing, a v0.6.0 version marker, missing routes, and leftover references to the pre-strip Pantheon/Minerva coupling). Removed the `mermaid` npm dependency and its own now-dead `mermaidTheme.ts` helper, both fully unused since consus-phase18 replaced Mermaid rendering with React Flow.

## [0.9.0] - 2026-08-18

### Added

- **`consus-phase18-diagram-editor-and-skin-system`:** diagrams (both the epic/story cascade and the architecture diagram) are now directly editable — drag nodes, edit labels, add/remove nodes, connect or delete edges (click-to-snip or multi-select) — with a real structured changeset and a "Fire to harness" action that reuses the existing `POST /api/proposals` mechanism unchanged. Powered by a real editable canvas (`@xyflow/react`), replacing the previous read-only Mermaid rendering. Alongside this, Consus gets its first-ever manual theme control (light/dark/system — previously OS-preference-only, with no override) and a new, fully independent visual-skin system with three real, switchable skins: Drafting Table (blueprint/drafting-table), Case Board (corkboard/case-file), and Harness (terminal/IDE) — each with genuine per-skin decoration, not just recolored chrome. A collapsible, read-only Mermaid source preview (regenerated live, never a second editable surface) and a universal ⌘K command palette with keyboard shortcuts round out the pass. Design synthesized from three independent, blind design-agent mockups plus a real cost-benefit analysis on the editing library (both artifacts live in the epic's `docs/`).

## [0.8.0] - 2026-08-17

### Added

- **`consus-phase15-wire-decision-classifier`:** `classifyItem` (the existing, fully tested decision-type + triage-bucket classifier) is now actually called — previously no route invoked it, so `decision_type`/`triage_bucket` were always `null` in every API response. Wired into `POST /api/decisions` (classify on create), `GET /api/decisions` (opportunistic backfill for any row whose `decision_type` is still `null`, leaving already-classified rows untouched), and the `decision_needed` event-detection pass (classifies inline, including on content-drift re-upserts). No changes to the classifier's own logic.
- **`consus-phase16-two-pane-decisions-layout`:** the Decisions tab is now a two-pane layout — a scannable left list and an independently-scrolling right detail panel — instead of one long flat page-scrolling list. The current selection is addressable via `?selected=<id>` on the URL (a hand-rolled hook, no router dependency added). The detail pane reuses the existing, richer `DecisionView` unchanged. Missing/unknown `?selected=` falls back to the first open decision, then first decided, then an empty state, without rewriting the URL; selection persists across a verdict-triggered reload. Collapses to a single column below 768px.
- **`consus-phase17-architecture-diagram-endpoint`:** a new `GET /api/diagrams/:repo/architecture` renders a repo's actual directory structure as a Mermaid diagram (top-level + a richer depth-2 view folding in file paths mentioned in planning docs), distinct from the existing epic/story dependency cascade at `GET /api/diagrams` (unchanged). Generated fresh on every request — no cache table, given the bounded/capped local scan and this project's single-operator scale. Rendered via a new `ArchitectureDiagramView` alongside the existing diagram/docs views on a project's page.

### Fixed

- **The HTTP server's bind host is now configurable via `HOST`** (default `127.0.0.1`, unchanged for standalone/local-dev). Previously hardcoded, which meant a containerized deploy's `127.0.0.1` bind was unreachable from outside the container — confirmed live via Pantheon's containerized deploy testing. Fixes #100.

## [0.7.0] - 2026-08-16

### Added

- **`consus-phase13-multirepo-doc-resolution` (REQ-20):** a `gitdocs` adapter (`extractDocCandidates` -> `resolveInRepos` -> `readGitDoc`) resolves a doc path across every configured repo, not just the one currently open, and can read it at a specific git ref via `git show` (`execFileSync` argument-array form — no shell, immune to metacharacter injection). `GET /api/docs/content` gains an optional `ref` param; a new `GET /api/docs/resolve` finds which configured repo a text reference actually points at. `resolveInRepos`'s path-traversal boundary check was independently code-reviewed (not just test-verified) before merging.
- **`consus-phase14-multirepo-event-pipeline`:** a new `POST /api/projects/scan-all` sweeps every configured project in one action (per-project ingest stays available alongside it). Every scan — all-projects or single-project — now runs two detection passes: `doc_changed` (a doc's content changed or is new) and `decision_needed` (an unresolved decision-request block). Each hit becomes a reviewable `events` row — deliberately a new table, separate from `proposals` (a proposal always means "fired at a harness"; an event is a pre-decision review-queue item that may never become one) — carrying a diff and a composed prompt (diff + surrounding doc content + area context), built once at detection time. Events have a manual status lifecycle (`new -> in_progress -> done/dismissed`), with `done`/`dismissed` automatically archived out of the active queue (`GET /api/events/history` surfaces the archive). An event can optionally graduate into a real proposal (`POST /api/events/:id/propose`, reusing the existing propose-a-change mechanism unmodified) — the seam a future Pantheon L2 ticket-adapter would consume for automatic dispatch in paired mode, deliberately not built here. Also ships a new Events tab (filters, sort, scan-all button, archived view, a purpose-built propose composer) and cross-repo doc search (`GET /api/docs/search`, path + live-content match, plus a search box on the Docs tab).
- A support section in `README.md`.

## [0.6.0] - 2026-08-15

### Changed

- **Consus is now fully standalone.** Removed every adapter, transport, and client class tied to a specific external system (Multica, Minerva, Auriga, Vesta, Votem) — `server/adapters/` now contains only the local `doc-scanner`. Consus's server has zero live network coupling to anything outside itself; it reads and writes only local SQLite + the filesystem. The generic `HarnessTransport` seam (`server/harness/transport.ts`) is the sole, optional, system-agnostic integration point for the propose-a-change mechanism — it defaults to a no-op. The prior Multica/Minerva-coupled work is preserved for reference on `archive/pantheon-coupled-consus`.
- `dev` and `main` were reconciled after diverging into two incompatible histories (a separate, more deeply Multica/Minerva-coupled development line had accumulated on `dev`). That line is preserved on `archive/dev-2026-08-11-pantheon-coupled`; `dev` now tracks `main`'s standalone lineage going forward, with the conventional feature-branch → `dev` → `main` flow.

### Added

- **`consus-phase6-standalone-onboarding`:** the entire "get started" loop, working standalone for the first time. `POST /api/projects/:project/ingest` wires the existing (previously untriggered) doc-scanner to an on-demand HTTP route; the per-project view now shows a project's diagrams, docs, and KB entries together with an "Ingest repo" action; a first-run onboarding screen replaces the blank tab shell on a fresh install.
- **`consus-phase7-decision-push-endpoint`:** `POST /api/decisions` — a generic endpoint so any local agent/harness can push a decision or CBA (cost-benefit analysis) into Consus's queue, using the same `decision-request/v1` contract Consus already parses. Documented in `skills/consus/SKILL.md` and `docs/api-reference.md`.
- **`consus-phase8-doc-editor-fire-action`:** in-place doc editing — an edit/view toggle plus a "Fire to harness" action that computes the diff automatically, replacing the old hand-typed raw-diff box. Reuses the existing `POST /api/proposals` endpoint unchanged.
- **`consus-phase9-mermaid-diagram-engine`:** the epic/story diagram cascade now renders as a real Mermaid graph (client-side, dynamically imported) instead of a plain nested list, with click-to-detail on individual story nodes.
- **`consus-phase10-decision-parser-tiers`:** decisions extracted heuristically from free-form prose (rather than a structured fenced block) are now distinguishable from structured ones via an `extractionTier` field, and route to a lower-confidence triage bucket (`agent_task` instead of `open_question`) so a heuristic guess isn't surfaced to a human with the same weight as a deliberate decision.
- **`consus-phase11-draft-submit-separation`:** KB entries can now be saved as a draft (`PUT /api/kb-entries/:id/draft`) without publishing, then explicitly promoted (`POST /api/kb-entries/:id/submit`) through the existing publish path — "Save ≠ Submit." Also fixes a real bug found along the way: KB search had no filter excluding draft content, which would have leaked unpublished drafts into search results.
- **`consus-phase12-sectional-diff-view`:** doc editing is now section-scoped (split at markdown heading boundaries) — editing or firing one section can never touch another section's in-progress edit.
- A living planning backlog (`.pHive/planning/backlog.md`) and refreshed vision doc (`.pHive/planning/vision-and-way-of-working.md`), grounded in a real inventory across every prior Delphi/Consus development line, distinguishing what's actually shipped from what's still open.

### Added

- **Phase 4 (`consus-phase4-close-the-loop`, REQ-16 — fire-agents-to-iterate):** `POST /api/decisions/:key/iterate` ports Delphi's real fire-agent-to-iterate feature — composes a comment with an `[@agentName](mention://agent/<id>)` mention line (the real Multica dispatch trigger, omitted entirely without both `agentId`+`agentName`), posts it through the existing single Multica-write path, optionally flips the issue to `in_progress`, and logs every request to a local traceability log (`GET /api/log`, filterable by issue). A "Fire agent to iterate" trigger and a Versions view (iterate-request history alongside the original content — not a diff UI, that's separate scope) are wired into the decision surface.
- `HttpMulticaClient` gained `getIssue()`/`updateIssueStatus()` (CLI-based, same as `listIssues()`). `writeCommentAndCache()` gained an optional `cacheItemId`, fixing a real correctness gap where the Multica-side write and the local cache row needed different ids.

### Changed

- **`consus-phase4-close-the-loop` release finalization.** Applied the planned `minor` version bump (`0.4.0` → `0.5.0`) for this epic's completion.

### Added

- **Phase 5 (`consus-phase5-live-and-interactive`):** the standalone loop is now real, not empty. `GET /api/decisions` syncs live from Multica on every read (classified via the existing `decision-request/v1` contract-first classifier, no per-item allowlists); the pre-cutover Multica archive (45 audit entries + 12 KB entries) is preserved and backfilled via a generic, reusable importer; KB entries can be grouped into collections (`marketing`/`boundary-decisions`/`plans`/`artifacts`/`general`), with tabs in the KB backlog browser.
- A generalized **propose-a-change-and-fire-to-harness** mechanism (`POST /api/proposals`, `POST /api/proposals/:id/result`, `GET /api/proposals`): Consus never writes `.pHive`/repo content directly — a diff + description is dispatched via the Minerva adapter, a harness applies it, and the result comes back as an audit entry. One mechanism shared by diagrams and docs.
- `GET /api/diagrams?repo=` renders each repo's real epic/story dependency tree from `.pHive/epics/` on disk, with an in-app viewer and a propose-a-change action.
- Doc viewing gained a propose-a-change mode (`DocRenderer`), reusing the same UI shape as diagrams.
- A shared audit-trail panel (`GET /api/items/:id/audit-trail`) merges plain decision history with fired proposals (pending/applied/failed) into one timeline, used identically across decisions, diagrams, and docs.
- 10 stories, live-verified end to end against real Multica/archive data throughout (not just unit tests).

### Changed

- **`consus-phase5-live-and-interactive` release finalization.** Applied the planned `minor` version bump (`0.3.0` → `0.4.0`) for this epic's completion.

## [0.3.0] - 2026-07-25

### Changed

- **`consus-phase2-survey-kb-api` release finalization.** Applied the planned `minor` version bump (`0.2.0` → `0.3.0`) for this epic's completion.
- Corrected the `decision-request/v1` contract in place to match the real, field-precise spec found in `mdostal/delphi` (options A-Z + tradeoffs + required `recommended`, four-verdict model) — see the `fix:` commit on `consus-v1-core-loop`.

### Added

- **Phase 2 (`consus-phase2-survey-kb-api`):** Minerva survey batching (REQ-26 — N related questions grouped with batch-completion progress), knowledgebase project scoping + cross-project view (REQ-27 — closes PRD GAP-01), a documented API reference + agent-harness skill definition (REQ-28), and `GET /api/decisions` (a real gap closed while writing that documentation — there was no way to list open decisions via HTTP at all).
- Consus v1 core loop: server + SPA + SQLite scaffold, Doc Scanner (`/api/docs`), KB store with audit log + versioning (decided-store amnesia fix), Minerva Question bridge, Multica comment read-write, Auriga read-only tracker state, `decision-request/v1` contract + deterministic renderer, decision-type taxonomy + triage buckets, Vesta policy adapter, votem quorum router, shared theme-aware `DecisionCard`, comment threads, doc browser + markdown rendering, Artifact linking, KB backlog search/filter/edit, and a living-docs overlay backend (docs + comments sources; idea board flagged as a follow-up).
- 23 stories total across two epics, 109 passing tests (TDD/BDD throughout).
