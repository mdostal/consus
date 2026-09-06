# Research Brief: consus-phase28-interaction-completeness

## 0. Prelude

Requested via `/plugin-hive:plan`: "deep dive from the long term vision and
ensure that we have fully verified, merged all PRs and then go through the
consus features to see if we've added the ability to see and interact with
wireframes and designs, multi stage and multi-step surveys, and all of the
many other interaction types for the overall decisions and consus board.
Also, the way we do diagrams should allow us to add, reconnect nodes, etc and
fire off the diff, ensure we have EVERYTHING fully implemented."

No `.pHive/CONTEXT.md` or prior KG decisions were queried for this run
(hand-run in-session). No `north_star` block exists in
`.pHive/project-profile.yaml` yet.

## 1. Pre-flight: PR verification and merge (completed before this brief)

Before any feature research, the orchestrator verified and reconciled all
open PRs against the repo's real git-flow (PR → `dev`; `main` is the release
branch, promoted separately at ship time — never touched directly):

- **`dev` and `main` had silently diverged.** `main` had accrued a mature
  decisions/survey feature stream (SurveyView, survey grouping, `dostal:
  feature-selection/v1`, FeatureChecklist, research sections, attachments)
  via a series of direct-to-main `PANT-1xx` PRs that never flowed back
  through `dev`. Meanwhile `dev`'s own tip commit was an independent,
  functionally-redundant reimplementation of the same FeatureChecklist
  feature, built against stale code (verified diff-by-diff: `main`'s version
  is a strict superset in every one of 7 conflicting files, plus additional
  test coverage `dev` lacked).
- Opened a real branch off `dev`, merged `main` in (`--no-ff`, no rebase, so
  the conflict-resolution history is preserved), resolved all 7 conflicts in
  favor of `main`, verified (964/964 tests, clean build), PR'd and merged to
  `dev` (#144).
- PR #121 (a real crash-repro fix — unmounted/unregistered repo paths crashed
  `scanRepo` with a native Node assertion failure) was wrongly targeting
  `main` directly. Retargeted to `dev`, verified clean, merged.
- The merge itself introduced a real bug: two independent fixes for the same
  underlying issue (`main`'s simple `existsSync` guard, and #121's facade-based
  validation) landed on non-conflicting lines of the same function, so git
  merged them without conflict markers into semantically broken code — a
  variable referenced before its declaration, and the facade path being
  redundantly gated by a stale local disk check. Found via full build+test
  (not caught by either PR's own CI, since each was green in isolation).
  Fixed directly on `dev` (commit `2d7c542`). Final state: 969/969 tests,
  clean build.

`dev` now contains the full, reconciled feature set. All research below was
performed against this reconciled `dev` tip.

## 2. Decision/survey interaction types — current state

**Spec vs. reality.** `docs/prior-art.md:70-83` defines 7 decision-type
renderers (`cba`, `choose`, `survey`, `edit`, `quorum`, `doc`, `default`)
driven by an orthogonal `AnswerShape`. Only 2 are wired end-to-end
(parser validates → UI renders → verdict recorded):

- `dostal:decision-request/v1` (`server/decision-contract/parser.ts:32-49`) →
  `web/src/features/decisions/answer-shapes/AnswerControl.tsx:26-93` →
  verdicts `accepted` / `option_chosen` / `mix` / `rejected_iteration_requested`.
- `dostal:feature-selection/v1` (`parser.ts:59-65`) → `FeatureChecklist.tsx`
  → verdict `features_selected`.

`cba`, `quorum`, `edit` exist only as **classifier output label strings**
(`server/decision-contract/classifier.ts:14,58-64`, a title-regex heuristic)
with no dedicated renderer — the classifier's own comment admits "'doc'
remains unreachable by either path... any other valid payload is 'choose'".
A CBA- or quorum-titled item falls straight through to the generic
options-based `AnswerControl`.

**SurveyView "multi-step" — exact mechanics confirmed**
(`SurveyView.tsx:49-197`, `server/routes/surveys.ts`): a survey is decisions
sharing one `survey_id`, rendered **simultaneously in one scrollable list**
with a shared progress bar and a completion banner once every member has
`decided_at`. There is no sequential gating, no locking, no branching — flat
grouping + progress tracking, not literal staged/paginated stepping.

**Confirmed already working (don't rebuild):** comments attach to decisions
generically (`server/routes/interactions.ts:26-42`, keyed by `item_id`).

**Confirmed absent:** free-text/open-ended answer, numeric/rating-scale
answer, ranking/drag-order answer, deadlines/expiry, bulk verdict actions
across a survey.

## 3. Wireframes/designs — current state

- **Doc-scanner is blind to `.pHive/design/`.** `SCAN_ROOTS =
  [".pHive/planning", ".pHive/epics"]` plus the phase27 `OVERVIEW_ROOT_*`
  additions (`server/adapters/doc-scanner/index.ts:22,35-36`). The Hive
  `/design` skill's wireframe-protocol output directory
  (`.pHive/design/<topic>/`, registered in `.pHive/design/index.yaml`) is
  never scanned — that entire artifact class is invisible to Consus today.
- **No image-rendering path in the doc UI.** `DocRenderer.tsx` runs
  `marked.parse`, which would emit a bare `<img>` for markdown image syntax,
  but no route serves arbitrary repo-relative image assets — a wireframe PNG
  referenced from a doc would 404 today.
- **Attachments backend already supports inline images; frontend doesn't use
  it.** `server/routes/attachments.ts:57` sets `INLINE_SAFE_TYPES` (including
  `image/png`/`jpeg`/`gif`) with `Content-Disposition: inline`, but
  `AttachmentItem.tsx` renders only a generic extension pill + Download link
  — no `<img>` preview anywhere in that component.

## 4. Diagram editor (phase20) — verified, not aspirational

VISION.md's diagram-editing claim is real, already shipped, and more
complete than the requirement implied. `DiagramCanvas.tsx` (shared by both
diagram views) implements: add node (toolbar `addNode()`), remove node,
in-place label edit, connect nodes (click-flow UI + native React Flow
drag-to-connect via `onConnect`), delete edges (click-to-snip + shift-click
multi-select + "Delete selected"), and full keyboard parity (arrow-key node
nudge, Enter/Space edge delete).

Every edit produces a typed `DiagramChange`, accumulated into a changeset,
fired through the **same generic `POST /api/proposals`** mechanism docs use
(`DiagramView.tsx:162-179`) — confirmed real, not scaffolding.

**The one real gap — shared with docs, not diagram-specific:** the diff is
*computed* everywhere but never *rendered visually*. Docs compute a line-diff
string (`computeLineDiff`) purely to embed in the proposal payload;
`DocRenderer.tsx` never renders it as colored add/remove lines. Diagrams show
a structured changeset *list* (add/remove/move/rename rows) plus a read-only
derived Mermaid preview — never a before/after visual overlay. "Fire off the
diff" works end-to-end today; "see the diff visually" doesn't exist anywhere
in the app.

## 5. Scope decision (user-confirmed)

Presented as a ranked gap list; user selected via AskUserQuestion:

**In scope for this epic:**
1. Attachment image preview (near-zero cost — backend already correct).
2. Rendered visual diff, shared component, for both doc line-diffs and
   diagram changesets (data already computed everywhere; only display layer
   missing).
3. Scan `.pHive/design/` for wireframes + serve the images, so `/design`'s
   output is actually visible/reviewable in Consus.
4. Dedicated `edit` and `cba` answer-shape renderers (classifier already
   emits these labels with nowhere to route them), plus new free-text and
   rating answer shapes (same proven `AnswerControl` dispatch pattern used
   twice already).

**Explicitly deferred, not part of this epic:**
- **True sequential/gated survey stepping** (locked one-at-a-time steps,
  optional branching) — a real UX redesign of `SurveyView`, not a small
  addition. Worth its own future design discussion once there's a concrete
  need for gating (today's flat-list-with-progress may be sufficient).
- **Quorum as a Consus-native answer shape.** User's own framing (verbatim
  intent, paraphrased): quorum/agent-voting is properly a *separate system's*
  responsibility (referenced: "Votum"). Consus's job is not to implement
  quorum logic — it's to expose a thin, generic approval API / middle-layer
  hook that an external system can call to gate, comment on, and ultimately
  approve or reject a decision on Consus's behalf, potentially across many
  surfaces beyond Consus. **This is a real, load-bearing architectural
  note for whoever picks up quorum/approval-delegation later** — it should
  not be reinvented as an in-app "quorum" UI. No story in this epic
  implements it; flagged here so the direction isn't lost.

## 6. Reuse inventory (why this is cheap)

Every in-scope item reuses an existing, already-proven mechanism — no new
infrastructure class is introduced:
- Image preview: existing `INLINE_SAFE_TYPES` attachment route, just needs a
  frontend `<img>` branch.
- Visual diff: existing `computeLineDiff` (docs) and changeset list
  (diagrams) data, just needs a shared render component.
- `.pHive/design/` scanning: same pattern as phase27's `OVERVIEW_ROOT_*`
  addition to `doc-scanner/index.ts`, plus one new image-serving route
  modeled on the existing attachments inline-serve route.
- New answer shapes: same parser-validates → `AnswerControl`-dispatches →
  verdict-recorded pattern already implemented twice
  (`decision-request/v1`, `feature-selection/v1`).
