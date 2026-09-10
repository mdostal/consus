# Design Discussion: consus-phase29-brand-decision-review

## 0. Prelude

No `.pHive/CONTEXT.md` or prior KG decisions were queried for this run
(hand-run in-session, matching the precedent set by phase26-28). No
`north_star` block exists in `.pHive/project-profile.yaml` yet. Full
research is in `docs/research-brief.md` — this document assumes it as read.

## 1. Goal

Close the loop the operator just hit live: a real design artifact
(`.pHive/brand/brand-guide.html`, five logo concepts) had to be reviewed and
decided on entirely outside Consus. After this epic:

- Consus scans `.pHive/brand/` and surfaces the brand guide as a real,
  viewable doc inside the app (correctly rendered — fonts, styles, the
  actual designed page, not a broken markdown-mangled fragment).
- A structured manifest of "here are N named concepts, pick one" becomes a
  real decision Consus can present and record a verdict on, through the
  same `POST /api/decisions/:id/verdict` mechanism every other decision
  already uses.
- This generalizes: any future design/brand artifact that ships a
  concept-selection manifest in the same shape gets picked up the same way
  — not hardcoded to "logos" specifically.
- The operator can go into Consus right now and record "monogram, selected"
  for the actual brand guide that was just built this session.

## 2. Proposed approach

Four slices, each independently completable and building on proven
patterns (research-brief §3):

**Slice A — `.pHive/brand/` scan root.** Mirror phase27's `OVERVIEW_ROOT_*`
/ phase28's `DESIGN_ROOT` pattern exactly: add `.pHive/brand/` as a fifth
scan root in `server/adapters/doc-scanner/index.ts`, tagging matched `.md`/`.html`
docs `phase: "brand"`, `epic: null` (repo-wide, like overview — not tied to
one feature). `brand-guide.html` becomes a real, indexed, queryable doc.

**Slice B — New answer shape: `dostal:concept-selection/v1`.** Generalized
"pick one of N options, each with a name/description and a visual preview"
— not logo-specific. Payload: `{ version, title, context, concepts: [{
id, name, description, preview: { kind: "svg", markup: string } }] }`.
New `ConceptSelection` renderer dispatched from `AnswerControl.tsx` (the
same one-more-branch pattern used for all six prior payload types), showing
each concept's rendered SVG preview side by side with a select action.
Verdict: `{ kind: "concept_selected", conceptId }`. Recorded through the
existing, completely unchanged verdict route.

**Slice C — Isolated brand-guide viewer.** `DocRenderer.tsx` cannot
correctly display a full self-contained HTML page (research-brief §1) — it
always runs the content through `marked.parse` into a `<div>`, which
silently mangles a real `<html>/<head>/<body>` document. A new, narrow
rendering path specifically for full-page HTML docs (detected by
`phase: "brand"`, or more generally by a doc actually containing a
`<!DOCTYPE` /full document structure) renders via `<iframe srcdoc={content}>`
instead — real isolation, the page renders exactly as designed, fonts and
all. Surfaced in `FeatureBrowser`/a small "Brand" section alongside
Overview (both are repo-wide, `epic: null`).

**Slice D — Manifest format + decision synthesis + real backfill.** Define
`.pHive/brand/logo-concepts.yaml` (name kept concept-specific for this
instance; the *shape* is what's reusable) conforming to the concept-selection
payload's `concepts[]` array. A small addition to the existing scan/ingest
path: when such a manifest exists and no decision item has been created for
it yet (keyed the same way every other decision gets its id —
`decision:<repo>:<manifest path>`, consistent with the existing scheme),
synthesize one real decision row carrying a `concept-selection/v1` payload
built from the manifest. Idempotent — re-scanning never recreates a
decision that already exists or is already decided. **Also**, as this
slice's concrete acceptance: author the real manifest for the brand guide
that already exists on disk (the five concepts, their real SVG markup
already sitting in `brand-guide.html`) so the operator's literal ask —
decide right now, in Consus — is satisfied by this epic shipping, not left
as a hypothetical future capability.

## 3. Explicitly out of scope

- **Changes to the `/brand-system` or `/logo-exploration` Hive skills
  themselves** (a separate repo, `plugin-hive`) to make them auto-emit
  `logo-concepts.yaml` going forward. This epic proves and ships the
  Consus-side capability and format against the real artifact that already
  exists; teaching the upstream skills to emit the manifest automatically
  is a natural, small follow-on for whoever picks up `plugin-hive` next —
  noted here so the direction isn't lost, not built in this epic.
- **Generic "any doc-scanner artifact becomes a decision"** — scoped
  specifically to manifests matching the concept-selection shape, not a
  general auto-decision-everything mechanism (a much bigger, riskier
  surface with no concrete need yet).

## 4. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| iframe `srcdoc` rendering a full page inside a card-shaped UI slot looks cramped/awkward compared to opening it full-page | medium | Give the brand-guide viewer a dedicated full-height view (not squeezed into the same card layout as a markdown doc), with an explicit "open in new tab" affordance as a fallback |
| Inline SVG markup stored directly in decision_payload / manifest YAML is a real (if narrow) content-injection surface if the source ever becomes less trusted | low | Source is always server/operator-authored (the brand-system skill's own output, or a human-edited manifest) — never end-user input. Note this constraint explicitly in the schema doc so it isn't loosened carelessly later |
| Auto-synthesizing a decision from a scanned manifest could double-create if the idempotency key is wrong | medium | Reuse the exact existing `decision:<repo>:<file_path>` id scheme already proven for doc-derived decisions — same dedupe guarantee as every other scanned decision |

## 5. Dependencies

Slices A and B are independent of each other. Slice C depends on A (needs
the scan root to exist so a brand doc can be fetched). Slice D depends on B
(needs the payload shape to exist before it can synthesize one) and
benefits from A (the manifest lives under the same scanned directory,
though the manifest itself is consumed directly by filename, not through
the generic doc-scanner doc-content path).

## 6. Open questions

1. **Where exactly does "Brand" surface in the UI** — folded into the
   existing Overview section (both `epic: null`), or a small distinct
   sibling section? Recommend: distinct sibling ("Brand"), since Overview
   today is pure-read docs and Brand carries an active pending decision —
   conflating them risks burying the decision under a docs list.
2. **Does the concept-selection answer shape need to support more than one
   preview kind (image, not just inline SVG) from day one?** Recommend:
   ship `svg` only now (matches the real artifact), design the payload's
   `preview` field as a tagged union so `image` (reusing phase28's
   `GET /api/design-assets` pattern) is a clean additive follow-up, not a
   breaking change later.

## 7. Scale assessment

**Medium.** Multi-file, multiple layers (doc-scanner, decision-contract
parser, a new answer-shape component, a new isolated-rendering component,
manifest ingestion), cross-stack, but each of the 4 slices is
independently well-understood, reuses a proven pattern from a prior phase,
and there's no long-horizon/migration risk. Proceeding directly to story
decomposition — the slices above already are the vertical plan.
