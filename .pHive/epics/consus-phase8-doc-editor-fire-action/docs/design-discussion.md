# Design discussion: doc editor fire action

## Goal

Consus's core loop is index → interact → propose → durable knowledge. "Interact"
is the weakest link today: viewing a doc means reading rendered markdown via
`DocRenderer` (`web/src/features/docs/DocRenderer.tsx`), and proposing a change
means switching to a separate "Propose a change" form and hand-typing a raw
text diff plus a description into two plain fields. Nothing in the UI helps the
operator compute that diff — they have to author it themselves, in diff syntax,
against content they can no longer see edited in place.

This epic replaces the hand-typed-diff box with an in-place edit/view toggle:
open a doc, click Edit, change the actual text in a textarea (not a diff), then
fire the change — Consus computes the diff for you and submits it through the
proposal pipeline that already exists. Scope is the doc-editing UX only; the
diagram view's own propose-a-change box (`ProjectDiagram` / `DiagramView`,
which shares `DocRenderer`'s same UI shape per its own comments) is
deliberately untouched — that's separate future work.

## What the archived reference actually did

`archive/dev-2026-08-11-pantheon-coupled:web/src/features/docs/DocEditor.tsx`
is a full-page doc editor (not embedded in a list/browse view) with:

- A `mode` state of `"view" | "edit"`, defaulting to `"view"`, toggled by an
  `Edit` button that only appears in view mode.
- View mode renders the doc through the same `DocRenderer` component used for
  read-only viewing. Edit mode swaps that out for a plain `<textarea>` bound to
  a `content` string, seeded from the fetched doc and reset to
  `originalContent` on `Cancel`.
- Two distinct submit-shaped actions, deliberately separate:
  - `Save` (`handleSave`) — PUTs the edited content to `updateDoc`, which hits
    `/api/docs/:id` and persists it as a row in a `doc_edits` table (a local
    draft/version, not yet "real"). This returns the view to view mode.
  - `Fire` (`handleFire`) — POSTs to `/api/docs/:id/fire` with no body; the
    server reads whatever content is currently on record (latest `doc_edits`
    row, falling back to disk) and creates an external tracker issue from it,
    then stamps the doc row with `fired_at` / issue id / issue URL. The UI
    shows an `isFiring` spinner state, surfaces `fireError` inline in red, and
    on success shows a persistent "Issue Link (Fired on ...)" line in the
    header linking out to the created issue.
- Save and Fire are independent actions — Fire does not require content to
  have just been edited, and in the sibling `DocEditorView.tsx` reference
  story (`cv1-06-doc-editor-ui`) Fire is explicitly disabled until a Save has
  produced an `edit_id`, i.e. "save, then optionally fire what you saved."

The parts of this we are **not** porting: the `doc_edits` draft table, the
`/api/docs/:id/fire` endpoint and its issue-creation body, `multica_issue_id`/
`multica_issue_url`/`fired_at` fields, and anything shaped around an external
tracker. Those are Minerva/Multica-coupled plumbing this codebase has
deliberately removed. What's worth keeping is purely the interaction pattern:
**view/edit toggle in place, edit the real content, an explicit second action
that submits it** — not "save-as-you-type."

## The decoupled approach for Consus's current architecture

Consus's current doc flow already has everything downstream of "compute a
diff" fully built and working:

- `server/routes/docs.ts` serves `GET /api/docs/content` with `{ repo, path,
  format, content, itemId }`, upserting an `items` row so a proposal always
  has a valid target. No draft/edit persistence layer exists or is needed —
  Consus never writes to the doc's source directly, by design (see
  `server/proposals/store.ts`'s own comment to that effect).
- `server/proposals/store.ts` + `server/routes/proposals.ts` already expose a
  generic `POST /api/proposals` accepting `{ itemId, targetType, diff,
  description, requestedBy }`, inserting a `pending` proposal row and
  dispatching through `HarnessTransport.invoke("proposeChange", ...)` — target-
  type-agnostic, already used identically for `targetType: "doc"` and
  `targetType: "diagram"`.
- `web/src/App.tsx`'s `DocsSection` already fetches the doc, opens it, and
  wires `DocRenderer`'s `onProposeChange` prop straight to `POST
  /api/proposals`, tracking `pendingProposalId` / `proposalFailureReason` and
  reloading the audit trail (`/api/items/:itemId/audit-trail`) after
  submission.

**Verified: no new backend endpoint is needed.** The only real gap is client-
side: `DocRenderer`'s "Propose a change" form (lines ~60-95) is a raw
description input + raw diff textarea, and the operator is the one computing
the diff by hand. The fix is to give `DocRenderer` (or the code that composes
its `onProposeChange` call) an edit mode that holds the *actual edited
content*, then computes a text diff between original and edited content at
submit time and passes that computed diff through the exact same
`onProposeChange({ diff, description })` contract that already exists. Nothing
downstream of that call changes.

This requires one new client-side capability Consus doesn't have yet: a way to
turn two content strings into a diff. No diff-generation library is currently
a dependency (`package.json` has no `diff`/`jsdiff`); adding one small,
dependency-free-ish text-diff utility (or a minimal line-diff implementation)
is the one new piece of surface area this epic introduces.

## Risks

- **Diff quality/format mismatch**: the harness on the other end of
  `HarnessTransport.invoke("proposeChange", ...)` was presumably built or
  tested against hand-typed unified-diff-like text. An auto-computed diff
  needs to produce output in a format the harness can actually consume
  (or the harness needs to be diff-format-agnostic, treating `diff` as
  effectively "the described change" rather than parsing it strictly).
  Needs verification against actual `HarnessTransport` implementations before
  this is called done.
- **Large docs**: a full-content textarea plus computing a diff on every fire
  is fine for the doc sizes currently indexed, but there's no size guard;
  extremely large docs could make both the textarea and diff computation
  sluggish. Low risk at current scale.
- **Lost edits on navigation**: entering edit mode, editing, then navigating
  away (e.g. "Back to docs") with no save/draft layer loses the in-progress
  edit silently. The archived version had the same gap even with `doc_edits`
  persistence (that table stored *submitted* saves, not autosave). Acceptable
  for this scope; worth a follow-up if it becomes a real complaint.

## Open questions

1. Should edit mode require a non-empty diff to fire (no-op edits blocked), or
   should an unchanged submission be allowed through as a no-op proposal? The
   archived Fire action had no such guard since it wasn't diff-driven.
2. Does the existing `HarnessTransport` implementation(s) used in this repo
   expect a specific diff format (unified diff, line-based, etc.), or is `diff`
   treated as opaque text? This determines whether the diff-computation
   utility needs to target a specific format precisely or just needs to be
   readable/descriptive.

## Scale assessment

**Small.** This is a client-side UX change confined to the doc-viewing
surface (`DocRenderer.tsx` and/or its caller in `App.tsx`'s `DocsSection`),
reusing an already-working backend endpoint unchanged. No new routes, no new
DB tables, no new external coupling. The only new dependency is a small
diff-computation utility.
