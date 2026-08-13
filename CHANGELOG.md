# Changelog

## [Unreleased]

## [0.4.0] - 2026-08-13

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
