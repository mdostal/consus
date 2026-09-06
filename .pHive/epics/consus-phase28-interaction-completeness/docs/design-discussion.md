# Design Discussion: consus-phase28-interaction-completeness

## 0. Prelude

No `.pHive/CONTEXT.md` or prior KG decisions were queried for this run
(hand-run in-session, matching the precedent set by phase26/phase27). No
`north_star` block exists in `.pHive/project-profile.yaml` yet. Full research
is in `docs/research-brief.md` — this document assumes it as read.

## 1. Goal

Close the gap between what Consus's decision/survey/diagram/wireframe
surfaces claim to do (per VISION.md and the original ask) and what's
actually wired end-to-end today, using only mechanisms already proven in the
codebase — no new infrastructure classes.

Concretely, after this epic:
- A wireframe/design image attached to a decision, or produced by the Hive
  `/design` skill under `.pHive/design/`, is actually *visible* in Consus,
  not just downloadable or invisible to the scanner.
- Every diff Consus already computes (doc line-diffs, diagram changesets) is
  actually *rendered*, not just embedded in a proposal payload.
- The 5 decision-type labels the classifier already produces (`cba`,
  `choose`, `edit`, plus two new answer shapes) have real renderers instead
  of silently falling back to the generic options UI.

## 2. Proposed approach

Four independent vertical slices, each reusing an existing mechanism:

**Slice A — Attachment image preview.** `server/routes/attachments.ts`
already serves images with `Content-Disposition: inline` via
`INLINE_SAFE_TYPES`. Add an `<img>` branch to `AttachmentItem.tsx` for
`image/*` mime types, falling back to the existing pill+download for
everything else. No server change needed — this is a pure frontend addition
against an existing, correct endpoint.

**Slice B — Rendered visual diff (docs + diagrams).** One shared diff-render
component, consuming data both flows already compute:
- Docs: `computeLineDiff`'s output, rendered as colored add/remove lines
  (a standard unified-diff view) inside `DocRenderer`'s proposal-review path.
- Diagrams: the existing changeset list (add/remove/move/rename), rendered
  with the same visual language (not necessarily a literal graph overlay —
  the changeset *is* the diff; the gap is purely that it's currently a plain
  list with no diff-styled emphasis). A stretch option (not required for
  slice completion): highlight added/removed nodes directly on the
  `DiagramCanvas` preview.

**Slice C — `.pHive/design/` wireframe scanning + viewing.** Mirror phase27's
`OVERVIEW_ROOT_*` pattern in `server/adapters/doc-scanner/index.ts`: add
`.pHive/design/` as a scan location, indexing each topic's `index.yaml` +
markdown artifacts the same way docs are indexed today. Add one new
image-serving route (modeled directly on the attachments inline-serve
pattern) so a wireframe PNG referenced from a design doc actually resolves
instead of 404ing. Surface scanned design topics somewhere reachable from
the existing `FeatureBrowser`/`FeatureDetailView` UI (phase27) rather than
inventing a third navigation surface.

**Slice D — New/completed answer shapes.** Two parts, same proven pattern
(parser validates → `AnswerControl` dispatches → verdict recorded) used
twice already for `decision-request/v1` and `feature-selection/v1`:
- Route the classifier's already-emitted `edit` and `cba` labels to real
  renderers instead of the generic fallback: `edit` as a line-diff-style
  proposed-change display with accept/reject; `cba` as a simple structured
  table/chart display of the compared options (cost-benefit rows), not a
  new computation engine — just a renderer for data the payload already
  carries or can carry with a small schema addition.
- Add two new answer shapes: free-text/open-ended response, and a
  numeric/rating scale response. Both are new `decision_payload` versions
  + new `Verdict` kinds, following the exact shape of the two existing
  payload types.

## 3. Explicitly out of scope (see research-brief §5 for full rationale)

- **True sequential/gated survey stepping.** Real UX redesign of
  `SurveyView`, deserves its own future design discussion once there's a
  concrete need for locking/branching beyond today's flat-list-with-progress.
- **Quorum as a Consus-native feature.** Per the user's explicit direction:
  quorum/agent-voting belongs to a separate system (referenced: Votum).
  Consus's eventual job is to expose a thin, generic external-approval
  middle-layer hook (something else can call in to gate/comment/approve a
  decision, potentially across many surfaces beyond Consus) — not to
  implement quorum logic itself. No story here builds this; it's recorded
  so the direction survives to whoever picks it up.

## 4. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Slice D's `cba` renderer scope-creeps into building an actual cost-benefit computation engine | medium | Explicitly scope to *rendering* payload-supplied comparison data, not computing recommendations — matches existing `AnswerControl` philosophy (renderer, not calculator) |
| Slice C's new image-serving route duplicates/diverges from the attachments route's security posture (path traversal, mime allowlist) | medium | Model directly on `attachments.ts`'s existing `INLINE_SAFE_TYPES` + path-safety pattern; do not invent a new access-control scheme |
| Slice B's diagram diff rendering scope-creeps into a full graph-overlay renderer | low | Ship the diff-styled changeset list first (cheap, matches "fire off the diff" ask literally); node-level highlight on canvas is optional stretch, not a completion gate |
| New answer shapes (Slice D) add payload versions without corresponding backend test parity | medium | Follow the existing test pattern for both prior payload types exactly (parser validation tests, route tests, component tests) |

## 5. Dependencies

Slices A–D are independent of each other (no story depends on another's
output) and can be planned/executed as parallel vertical slices. All four
depend only on already-shipped, already-reconciled `dev` (phase20 diagrams,
phase26 desktop app, phase27 feature-doc-review, and the phase28 pre-flight
PR reconciliation completed just before this design discussion).

## 6. Open questions (resolved)

1. **Slice C navigation — resolved: fold into `FeatureBrowser`.** Matches
   phase27's "one place to review everything about a feature" goal.
2. **Slice D `cba` payload shape — resolved: define a minimal schema now.**
   `{ options: { option, cost, benefit, notes? }[] }`, no upstream producer
   exists. Renderer only, not a computation engine.
3. **Slice D new answer shapes — resolved: widen to all three.** Free-text,
   rating, *and* ranking/drag-order — not just the originally-selected
   free-text+rating pair.

## 7. Scale assessment

**Medium.** Multi-file, multiple layers (server routes, doc-scanner,
parser/classifier, several React components), cross-stack, but each of the
4 slices is independently well-understood with no cross-slice sequencing
requirement and no long-horizon/migration risk. Per default medium-scope
routing, proceeding directly to story decomposition (one story per slice,
matching the vertical-slice boundaries above) rather than a full H/V
planning pass — the slices above already *are* the vertical plan.
