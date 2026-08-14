# Design Discussion — consus-phase12-sectional-diff-view

## Goal

`.pHive/planning/roadmap.md` (Phase 5) lists:

> REQ-18: Sectional Review with Non-Destructive Diff.

The roadmap gives no elaboration beyond that one line — no mechanics, no
acceptance criteria. Before writing anything new, the actual current state
of `web/src/features/docs/DocRenderer.tsx` was re-read in full (it was
touched tonight by consus-phase8). As of this branch it implements a
**whole-document** edit/fire flow: an Edit button swaps the rendered content
for a single `<textarea>` seeded with the full doc; a "Fire to harness"
button runs `computeLineDiff(content, draft)` (`web/src/features/docs/textDiff.ts`,
a whole-string LCS line diff) over the *entire* document and POSTs the result
to `/api/proposals`. There is no concept of a "section" anywhere in current
`web/src` or `server` — confirmed by grep (`sectional|section.*diff` — no
hits outside this new epic's own files). REQ-18 is genuinely unbuilt.

## What "sectional, non-destructive" means (per the documented/archived reference)

Since the roadmap line has no detail, the archived branch
`archive/dev-2026-08-11-pantheon-coupled` was checked for a prior, more fully
worked design. It contains a related (unshipped) epic,
`consus-editable-artifact-doc`, with two stories and a partial implementation
that give REQ-18 concrete shape:

- **Sectional = split by markdown heading.** `web/src/utils/sections.ts` in
  that archive:
  ```ts
  export function splitIntoSections(content: string): string[] {
    const parsed = content.split(/(?=^#{1,3} )/m).filter((s) => s.trim().length > 0);
    return parsed.length > 0 ? parsed : [content];
  }
  ```
  Content is split at each h1/h3 heading boundary (a heading and its body
  text travel together as one unit); if there are no headings, the whole doc
  is one section. This matches the constraint in this story's brief and is
  the obvious approach given the content is markdown — confirmed, not
  invented.

- **Non-destructive = per-section, explicit accept/send-back, not
  whole-doc last-write-wins.** `web/src/features/docs/SectionDiff.tsx` in the
  archive renders one section's human draft against the agent/published
  version as an inline word-level diff (`<ins>`/`<del>`), with two explicit
  buttons: "Accept Agent Changes" (take the agent's version for *this
  section only*) and "Send Back" (keep the human edit for *this section
  only*, reject the agent's regenerated section). The corresponding story
  (`sectional-diff-view.yaml`) states the acceptance criterion directly:
  *"Given a subsequent agent pass, when generated, then prior human edits
  are never automatically overwritten."* I.e. the unit of conflict and the
  unit of resolution is the section, not the document — a human's
  still-pending edit to section B is untouched by an agent's (or a second
  human's) edit landing in section A, and nothing auto-applies over a
  human's edit without an explicit per-section accept.

- **Explicit vagueness in the source, flagged rather than invented:**
  the archived `sectional-diff-view.yaml` describes "human draft edits
  against the agent-generated version" and depended on a separate
  `editable-sections-ui` story that itself depended on `save-submit-actions`
  (durable Save-vs-Submit draft persistence — this is REQ-17, a distinct
  roadmap item, not part of REQ-18). The archived design assumes a
  *persisted, reloadable* human draft that can diverge from an
  *independently regenerated* agent version arriving later, and reconciles
  the two per section. Mainline's current `DocRenderer.tsx` has no draft
  persistence at all (drafts are in-memory React state, discarded on
  `content` prop change) and no notion of an agent-regenerated version
  separate from the human's own edit — mainline's "Fire to harness" is the
  human proposing *their own* edit for review, not two independently-authored
  versions being reconciled. The archive's full vision (reconcile human vs.
  agent authorship over time, with durable drafts) is genuinely larger than
  what "sectional diff, grounded in current DocRenderer.tsx" can deliver in
  one story tonight. What direct grounds is: **split the document into
  independently-editable sections, and diff/fire each section
  independently** — the same fire-to-harness mechanism DocRenderer already
  has, applied per-section instead of to the whole document. Multi-actor
  (human-vs-agent, not just human-vs-original) conflict reconciliation and
  durable draft persistence are out of scope for this pass; see Descoping
  below.

## Approach — extending mainline's `DocRenderer.tsx`

Grounded directly in the current file (`web/src/features/docs/DocRenderer.tsx`,
~140 lines, `mode: "view" | "edit"` React state, single `draft` string,
single `description` input, `fire()` calling `computeLineDiff(content, draft)`
then `onProposeChange({ diff, description })`):

1. **Section splitting.** Reintroduce `splitIntoSections(content)` (ported
   from the archive's `sections.ts`, same h1–h3 heading-boundary regex) as a
   pure utility — likely `web/src/features/docs/sections.ts` to stay
   colocated with `textDiff.ts` rather than reviving a top-level
   `web/src/utils/` directory that doesn't exist on mainline.
2. **Per-section edit state.** Replace the single `mode`/`draft`/`description`
   trio with an array keyed by section index: each section independently
   toggles view/edit, holds its own draft text and its own description
   input. Sections not being edited keep rendering their existing
   `marked.parse` output; a section in edit mode swaps to a textarea, same
   as today's whole-doc behavior but scoped to that section's slice of text.
3. **Per-section fire.** Each section's "Fire to harness" computes
   `computeLineDiff(originalSectionText, editedSectionText)` — reusing
   `textDiff.ts` unchanged — and calls the same `onProposeChange({ diff,
   description })` prop, unchanged contract, still hitting the existing
   `POST /api/proposals` route (`server/routes/proposals.ts`, unchanged).
   Firing section N does not touch, discard, or require agreement from any
   other section's in-progress edit — that is the "non-destructive" part
   this slice actually delivers: editing/firing one section can never
   silently clobber another section's independent pending edit, because
   each section's state (`draft`, `description`, `mode`) is isolated.
4. **Reassembly on view.** View mode renders sections by joining them back
   in order and running the existing whole-doc `marked.parse` — no change to
   markdown rendering itself, only to what feeds the textarea/diff.
5. **No backend change.** `/api/proposals` already accepts an opaque `diff`
   string per proposal; a per-section fire is simply N independent calls to
   the same endpoint with the same body shape (`itemId`, `targetType`,
   `diff`, `description`, `requestedBy` — see `server/routes/proposals.ts`).
   This keeps the story backend-free, matching the "small/medium scope" and
   "existing endpoint stays the fire target" constraints.

## Descoping — what this pass deliberately does NOT build

The full REQ-18 vision implied by the archive (durable per-section draft
persistence surviving reload, reconciliation against an independently
*agent-regenerated* version arriving later, a dedicated `SectionDiff`
accept/send-back-against-agent-output UI) is a multi-story arc, not a
one-night slice — it explicitly depended on REQ-17 (Save ≠ Submit draft
persistence) in the archive's own dependency graph, and REQ-17 does not
exist on mainline yet either. Building the full vision now would mean
inventing draft persistence and an agent-regeneration concept neither of
which mainline has any hook for today.

This epic scopes down to the smaller, real, valuable slice that stands on
its own and is honestly achievable against tonight's actual `DocRenderer.tsx`:

> **Split the document into sections at markdown heading boundaries; give
> each section independent edit/diff/fire state so that editing and firing
> one section can never discard or interfere with another section's
> in-progress edit.**

This is "non-destructive" in the one sense that's actually buildable today:
section-level isolation of in-progress edits, not cross-session
human-vs-agent reconciliation. That larger reconciliation problem (REQ-17's
durable drafts + true two-author diffing) is left as explicit future work,
not silently dropped — see Open Questions.

## Risks

- **Scope creep back toward the full archive vision.** The archive's
  `SectionDiff.tsx` (word-level `<ins>`/`<del>` diff against an
  agent-authored version, with Accept/Send-Back buttons) is a different,
  larger feature than "N independent whole-section fires." It's tempting to
  port `SectionDiff.tsx` wholesale, but doing so without REQ-17's draft
  persistence underneath it would build UI for a reconciliation flow that
  has no real second version to reconcile against on mainline today. The
  story below intentionally reuses the existing `computeLineDiff`
  fire-and-forget pattern instead.
- **Heading-boundary splitting is a heuristic, not a guarantee.** Docs with
  no headings collapse to one section (matches today's whole-doc behavior,
  safe fallback). Docs with headings inside fenced code blocks (` ```# not a
  heading``` `) would be mis-split by the naive regex — the archive's
  regex has this same gap; flagged here rather than silently inherited
  without note. Low risk in practice for `.pHive/` planning docs, worth a
  one-line acknowledgment in the story, not a blocking redesign.
- **UI real estate.** N sections each showing their own Edit/Fire controls
  and (while editing) a textarea + description input is more visual surface
  than today's single toggle. Not a rewrite-scale risk, but worth a design
  pass on affordance (e.g. collapsed-by-default edit controls) if it looks
  cluttered in practice — noted as a follow-up, not a blocker.
- **Test surface.** `DocRenderer.test.tsx` (currently 208 lines) has direct
  assertions against single-`textarea`/single-Edit-button structure
  (`getByTestId("doc-edit-textarea")` etc., singular). Those tests will need
  updating for a per-section structure; not a hidden cost, just called out
  so the story accounts for it explicitly.

## Open questions

1. Should a doc with **zero** headings still get the new per-section
   plumbing (as a single implicit section), or should it fall back to
   today's exact whole-doc behavior verbatim? The archive's
   `splitIntoSections` already returns `[content]` for no-heading input, so
   the per-section code path is designed to degrade to the old behavior for
   free — recommend keeping it that way rather than branching, but flagging
   this as worth a second look during implementation.
2. When the user has unfired edits open in two or more sections
   simultaneously, should there be any cross-section affordance (e.g. "fire
   all changed sections"), or is strictly-independent per-section firing
   (the scoped-down behavior) sufficient for this pass? Recommend strictly
   independent for now — no batch action — since the roadmap gives no
   signal either way and independent-per-section is the smaller, safer
   surface.

## Scale assessment

Small-to-medium, single story, achievable in one session:
- One new pure utility (`sections.ts`, ~10 lines, direct port).
- One component rework (`DocRenderer.tsx`) from single-mode state to an
  array of per-section state — mechanical, not architectural; the
  edit/diff/fire logic itself (`computeLineDiff`, `onProposeChange`
  contract, `/api/proposals`) is entirely reused, unchanged.
- Test updates to `DocRenderer.test.tsx` for the new per-section DOM shape.
- No backend, no schema, no new endpoint, no new external coupling.
