# Design discussion: KB draft/submit separation (REQ-17, Save ≠ Submit)

## Goal

`server/kb/store.ts` has exactly one write path for a KB entry's content:
`createKbEntry()`. Every call — whether from the initial ingest, a decided
item's write-back, or (if ever wired) a direct edit through
`PUT /api/kb-entries/:id` — immediately inserts a new `kb_versions` row *and*
repoints `kb_entries.current_version_id` to it. There is no way to persist an
in-progress edit without it instantly becoming "the" published content. This
epic adds that missing path: a `draft` state that can be saved, revised, and
re-saved without touching what's published, plus an explicit `submit` action
that promotes a specific draft to published. Confirmed via `grep -rn
"draft|Save.*Submit|pipeline" server/kb --include="*.ts"` (no hits) and a full
read of `server/kb/store.ts` (124 lines, one write function) that this is
genuinely missing on `feat/consus-phase11-draft-submit-separation` — not a
stale backlog item.

Scope is the KB store's persistence path plus the two HTTP endpoints that
front it. No frontend wiring: there is no current UI caller of
`PUT /api/kb-entries/:id` at all (`grep` across `web/src` turns up only the
`GET /api/kb-entries` list/search calls in `App.tsx` and `ProjectView.tsx`;
`KBBrowser.tsx` only wires `DecisionCard`'s approve/reject `onDecide`, not
content editing). The doc editor's "Fire to harness" flow
(`web/src/features/docs/DocRenderer.tsx`, built in phase8) is a different
subsystem — it diffs and posts to `POST /api/proposals`, which routes through
`HarnessTransport` for docs on disk, not `kb_entries` rows — so there is no
existing Save-vs-Submit UI pattern to extend here. Since there's no live UI
surface to build on and the constraint is small/medium scope, this epic stays
backend-only; wiring a KB content editor into `KBBrowser.tsx` is a natural
follow-up once something actually needs to call these endpoints.

## What the archived reference actually built

`archive/dev-2026-08-11-pantheon-coupled` has two unrelated things that both
touch "draft": a Minerva-coupled full-page `DocEditor.tsx` (`doc_edits` table,
`POST /api/docs/:id/fire` creating an external tracker issue, `fired_at`/
`multica_issue_id`/`multica_issue_url` fields) — not relevant here, already
correctly excluded by this codebase's standalone-only constraint — and the
actually relevant piece: `server/kb/pipeline.ts` + matching additions to
`server/kb/store.ts` and `server/routes/kb.ts`. That second piece has **no**
Minerva/Multica references anywhere (`git show ...:server/kb/pipeline.ts`,
`...:server/kb/store.ts` grepped clean for `minerva|multica`) — it's a plain
SQLite state-machine change, safe to port as-is in spirit.

What it did, concretely:

- `kb_versions` gained a `state: "published" | "draft"` column (schema in
  `005_v1_core_schema.sql`, not present on mainline's `migrate.ts`).
- `store.ts` kept `createKbEntry()` unchanged (always writes
  `state: "published"` and repoints `current_version_id`) and added
  `saveKbDraft()`: inserts a `kb_versions` row with `state: "draft"` and
  **never** touches `current_version_id`. Also added `getKbDraftVersions()`.
- A new module, `server/kb/pipeline.ts`, added `triggerApprovalPipeline()`:
  looks up a specific draft `kb_versions` row by id, then calls
  `createKbEntry()` with that draft's content — i.e. "submit" is implemented
  as promoting a draft by re-running the exact same publish path every other
  write already uses, not a bespoke promotion routine. It returns a
  `phases: { approve, phaseSplit, kb }` result shape; approve/phase-split are
  recorded as fired no-op flags with a comment noting they're "hooks for
  downstream consumers to attach to later" — there's no separate
  approval/phase-split system in this codebase to actually call.
- Routes: `PUT /api/kb-entries/:id/draft` (calls `saveKbDraft` only) and
  `POST /api/kb-entries/:id/submit` (calls `triggerApprovalPipeline` only,
  defaulting to the latest draft if no `versionId` given, 404 if none
  exists). The original `PUT /api/kb-entries/:id` (immediate-publish) stayed
  as-is, unchanged, alongside the new draft path.
- **Isolation is structural, not a literal parsed-import test.** I looked for
  the "never imports" test the task description anticipated and it doesn't
  exist as such — `pipeline.test.ts` and `kb.test.ts` have no static
  import-graph assertion. What actually enforces isolation: `store.ts` has
  zero dependency on `pipeline.ts` (the import only goes the other
  direction), and the `/draft` route handler calls only `saveKbDraft`, never
  `triggerApprovalPipeline`. `pipeline.test.ts`'s "leaves the original draft
  row untouched (append-only) after submit" test is the closest thing to a
  behavioral isolation proof: submit creates a *new* published row and
  leaves the draft row's `state` and `content` exactly as saved.

## The approach for current mainline

Same shape, ported cleanly, grounded in mainline's actual current schema
(`server/db/migrate.ts`) and routes (`server/routes/kb.ts`):

1. **Schema** (`server/db/migrate.ts`): add `state` via the existing
   `addColumnIfMissing()` guarded-`ALTER TABLE` pattern already used for
   every other post-hoc column on this table (`source_repo`, `collection`) —
   `TEXT NOT NULL DEFAULT 'published' CHECK(state IN ('published','draft'))`.
   Default `'published'` means every existing row and every existing
   `createKbEntry()` call keeps working unchanged; no backfill needed.
2. **Store** (`server/kb/store.ts`): add `saveKbDraft()` (draft insert, no
   `current_version_id` write) and `getKbDraftVersions()`. `createKbEntry()`
   is untouched — it becomes implicitly `state: 'published'` on the insert.
3. **Pipeline** (new `server/kb/pipeline.ts`): add `triggerApprovalPipeline()`
   exactly as the archived version did — look up the draft row, call
   `createKbEntry()` with its content to publish it. `store.ts` must not
   import this module; `pipeline.ts` imports from `store.ts`.
4. **Routes** (`server/routes/kb.ts`): add `PUT /api/kb-entries/:id/draft`
   and `POST /api/kb-entries/:id/submit`, mirroring the archived shape
   (submit defaults to latest draft if `versionId` omitted, 404s if none
   exists or entry unknown). Leave the existing
   `PUT /api/kb-entries/:id` immediate-publish route exactly as-is —
   it's unused by any current UI but removing or changing it isn't in scope.

## Risks

- **Two publish paths look redundant.** `createKbEntry()` (immediate) and
  `triggerApprovalPipeline()` (draft-then-submit) both end up calling the
  same publish logic, and nothing forces callers toward one or the other.
  Acceptable — the immediate path exists for ingest/write-back callers that
  have no reason to draft; only a future editing UI would choose between
  them, and it isn't being built in this epic.
- **`state` default silently changes `getKbEntries()` search semantics if a
  caller forgets to filter.** The archived version's `getKbEntries()` added
  `v.state = 'published'` to its search-join `WHERE` clause specifically so
  draft content never leaks into search results. Mainline's current
  `GET /api/kb-entries` search join (`server/routes/kb.ts`, inline SQL) has
  no such filter today because there's no draft state to leak. Adding the
  `state` column without also adding this filter would let draft content
  surface in search. Must be added as part of this epic, not deferred.
- **No UI to exercise the new endpoints.** Since nothing currently calls
  `PUT /api/kb-entries/:id`, the new draft/submit routes will also go
  uncalled by the app itself until a UI is built — correctness rests on
  route-level tests (`app.inject`) alone, same pattern the archived
  `kb.test.ts` used.

## Open questions

1. Should `getKbEntries()`'s non-search (no `?q=`) path also exclude drafts,
   or is a draft-only entry (one that's never been published) expected to
   still show up in the plain list? The archived version's plain-list query
   had no `state` filter at all — only the `?q=` search join did.
2. Should the pre-existing `PUT /api/kb-entries/:id` immediate-publish route
   be deprecated once draft/submit exists, or left indefinitely as a
   fast-path for ingest-style callers that never want a draft step? No
   current caller to consult; leaving it alone is the safe default for this
   epic's scope.

## Scale assessment

**Small.** One additive, backward-compatible schema column; two new store
functions; one new ~30-line module; two new routes reusing existing
publish logic. No new tables, no UI changes, no external coupling — fully
consistent with Consus's standalone-only constraint.
