# Changelog

## [Unreleased]

### Changed

- **`consus-phase2-survey-kb-api` release finalization.** Applied the planned `minor` version bump (`0.2.0` → `0.3.0`) for this epic's completion.
- Corrected the `decision-request/v1` contract in place to match the real, field-precise spec found in `mdostal/delphi` (options A-Z + tradeoffs + required `recommended`, four-verdict model) — see the `fix:` commit on `consus-v1-core-loop`.

### Added

- **Phase 2 (`consus-phase2-survey-kb-api`):** Minerva survey batching (REQ-26 — N related questions grouped with batch-completion progress), knowledgebase project scoping + cross-project view (REQ-27 — closes PRD GAP-01), a documented API reference + agent-harness skill definition (REQ-28), and `GET /api/decisions` (a real gap closed while writing that documentation — there was no way to list open decisions via HTTP at all).
- Consus v1 core loop: server + SPA + SQLite scaffold, Doc Scanner (`/api/docs`), KB store with audit log + versioning (decided-store amnesia fix), Minerva Question bridge, Multica comment read-write, Auriga read-only tracker state, `decision-request/v1` contract + deterministic renderer, decision-type taxonomy + triage buckets, Vesta policy adapter, votem quorum router, shared theme-aware `DecisionCard`, comment threads, doc browser + markdown rendering, Artifact linking, KB backlog search/filter/edit, and a living-docs overlay backend (docs + comments sources; idea board flagged as a follow-up).
- 23 stories total across two epics, 109 passing tests (TDD/BDD throughout).
