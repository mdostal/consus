# Research Brief — consus-phase5-live-and-interactive

## Requirement

Get the standalone Consus build to the point where Mathew can actually live in
it day-to-day: see real (not empty) data, view and interact with `.pHive`
files per repo, audit decisions, view/change diagrams, accept items, and send
work back to the harness to iterate — all from the UI, without opening files
by hand. Plugin-mode (Janus L2 integration) is explicitly deferred until
standalone is solid.

## Grounding: the reconciliation survey

Full detail: the "Consus Reunification Map" artifact produced this session
(2026-08-12), built from direct SSH inspection of `dostal@hive` (host
thes-mac-studio.lan) and this Mac. Summary of what's relevant to this epic:

- **This Mac's build is the least feature-complete of the surviving copies.**
  Hive's `~/code/consus@dev` (PR #86) already proved live Multica ingestion
  works (commits `99f5d57`/`3e99853`/`c4ddca3`, tickets PAN-7773/7776/7775),
  plus has `routes/diagrams.ts` (cascade org-tree, PAN-7956) that this build
  doesn't. Neither of those is present here yet — they're the two biggest
  functional gaps blocking "see real data" and "change diagrams."
- **Claud-ometer's `/delphi` route is already retired** (branch
  `feat/PAN-7774-retire-delphi`, 2026-08-08, route directory gone from disk).
  Its classifier logic (`review-queue.ts`, `decided-store.ts`,
  `verified-buckets.ts`) is proven-live reference material for wiring
  ingest here, and is what hive's dev branch ported from.
- **Two data files hold the entire live decision history** and exist nowhere
  else: `~/.multica/delphi-audit.jsonl` (45 entries, hive) and
  `~/.multica/delphi-knowledgebase.jsonl` (12 entries, hive). Not derivable
  from any git repo. Must be copied off hive and imported before anything
  destructive happens to the source.
- **KB-01 collection schema** (`~/.review-bootstrap/consus-kb01`,
  `feat/PAN-6478-kb-01-collection-schema`, commit `bc16eb4`) is a complete,
  tested, unmerged mini-epic: `server/db/migrate.ts`, `server/kb/store.ts`,
  `server/routes/kb.ts` + tests, 18 files, 1771 insertions. Not reachable
  from any dev history. Written against an older KB schema — needs
  re-verification against this build's current `server/kb/store.ts`, not a
  blind cherry-pick.
- **Delphi's UX features** (clients-tab, five-section-KB, drag-collapse) and
  the **Janus L2 plugin surface** (`consus-surface`) are real and unmerged
  but out of scope for this epic per the phasing above — logged for a later
  epic once standalone is live.

## Grounding: what already exists in this build (verified against source)

- **Routes** (`server/index.ts`): `docs`, `kb`, `artifact-links`, `decisions`,
  `interactions`. No `diagrams`, `epics`, `workflows`, `questions`, or
  `attachments` routes exist yet.
- **Web features** (`web/src/features/`): `comments`, `decisions` (DecisionCard
  + AnswerControl — Accept/Mix/Reject already implemented, see `App.tsx:163`),
  `docs` (DocBrowser, DocRenderer, ArtifactLink — **render-only, no editing**),
  `kb` (KBBrowser, BacklogBrowser), `minerva` (QAQueue, SurveyGroup),
  `projects` (ProjectView, GlobalView — the "one tab per repo + global view"
  north-star requirement).
- **Data model** (`architecture.md`): `audit_log` table already exists in the
  schema sketch (append-only, item_id/actor/field/old_value/new_value) — but
  there's no UI surfacing it yet. "Audit" as a user-facing capability is a
  UI gap, not a data-model gap.
- **`consus-phase4-close-the-loop`** — an existing sibling epic, already
  planned (2 stories: `iterate-endpoint-and-log`, `versions-view-and-trigger`),
  status `pending` in both story YAMLs, **and genuinely not yet built** (no
  `iterate` endpoint or Versions view found in current server/web source).
  This is exactly the "send back, iterate" half of the requirement. **Do not
  re-plan it here** — it's already agent-ready. This epic should sequence
  around it (see design discussion), not duplicate it.
- **Doc editing** ("make changes... in the UI") has no existing story
  anywhere in this repo's planning history under the current architecture.
  Some superseded hive planning branches (`consus-v1-core-fa982783`,
  `consus-v1-core-871`) had doc-editor stories, but those branches are
  planning-only artifacts from a different (Multica-native) architecture
  and were never built. This is a genuine net-new gap for this epic.

## Files most relevant to implementation

| File | Why it matters |
|---|---|
| `server/adapters/multica/client.ts` | Existing Multica client — extend for live polling/ingest, don't replace |
| `server/decision-contract/classifier.ts` | Where ported classifier logic from Claud-ometer's `review-queue.ts` lands, adapted to `decision-request/v1` |
| `server/routes/decisions.ts` | Needs a sync/ingest endpoint alongside existing routes |
| `server/kb/store.ts`, `server/db/migrate.ts` | Target for KB-01's schema port and historical-data import |
| `web/src/features/docs/DocRenderer.tsx` | Currently render-only; doc-editing needs an edit-mode extension here |
| `web/src/features/projects/{ProjectView,GlobalView}.tsx` | Where diagram views and audit-trail views need a new tab/section |
| `.pHive/epics/consus-phase4-close-the-loop/` | Sibling epic to sequence around, not duplicate |
