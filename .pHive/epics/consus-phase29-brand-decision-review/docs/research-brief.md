# Research Brief: consus-phase29-brand-decision-review

## 0. Prelude

Requested via `/plugin-hive:plan`, following directly from a live session
that produced Consus's first real brand system (`.pHive/brand/brand-system.yaml`,
`.pHive/brand/brand-guide.html`, five logo concepts, monogram selected by the
operator) entirely **outside** Consus — the whole review-and-decide loop
happened in chat, with a raw HTML file opened locally. The operator's own
words: "the only sad thing was that I didn't choose the actual monogram and
view the entire brand guidelines IN CONSUS... build consus to literally take
back and do this when this is given... we have the output already, now i
just need to be able to make the decision and submit IN CONSUS."

## 1. What exists today, confirmed by direct read

**Doc-scanner** (`server/adapters/doc-scanner/index.ts`) has four scan
locations, each added incrementally by a prior phase: `SCAN_ROOTS =
[".pHive/planning", ".pHive/epics"]` (line 22), `OVERVIEW_ROOT_FILES`/`OVERVIEW_ROOT_DIR`
(phase27 — repo-root README/VISION/docs/, tagged `phase: "overview"`,
`epic: null`), and `DESIGN_ROOT = join(".pHive", "design")` (phase28 s3 —
wireframe topics, tagged `phase: "design"`, `epic: <topic name>`). **`.pHive/brand/`
is not scanned at all** — confirmed by direct read of every root the scanner
walks. `DOC_EXTENSIONS = new Set([".md", ".html"])` — `.html` is already a
first-class doc extension, but `brand-guide.html` would not be picked up
without a new scan root, and `brand-system.yaml` (the structured data half)
isn't a doc-scanner extension at all (by design — it's data, not a doc).

**`DocRenderer.tsx` cannot correctly display a full standalone HTML
document.** Confirmed by direct read (`web/src/features/docs/DocRenderer.tsx:98,105,218`):
regardless of the `format` prop (`"md" | "html"`), the view path always runs
`marked.parse(content)` and injects the result via `dangerouslySetInnerHTML`
into a `<div>`. For a genuine HTML *fragment* (an existing planning-doc HTML
sidecar) this degrades acceptably — markdown parsers pass raw HTML blocks
through largely unchanged. For a **full self-contained page** like
`brand-guide.html` (its own `<!DOCTYPE>`, `<head>` with Google Fonts
`<link>`s and a large `<style>` block, `<body>`) this breaks: browsers
silently normalize/strip `<html>`/`<head>`/`<body>` when they appear as
children of a `<div>`, so fonts, styles, and structure would not render
correctly in-app. **This means the brand guide genuinely cannot be embedded
through the existing doc-rendering path — it needs isolated rendering** (an
`<iframe>`, which is the standard, correct way to embed a self-contained
HTML document without DOM/CSS collision with the host page).

**The decision-contract/answer-shape pattern is proven six times over** and
is directly reusable for "pick one of N things": `server/decision-contract/parser.ts`
defines a payload type (`version`, `title`, `context`, plus type-specific
fields), `web/src/features/decisions/answer-shapes/AnswerControl.tsx`
dispatches on `payload.version` to a dedicated renderer component, and a
verdict is recorded via the existing `POST /api/decisions/:id/verdict`
route (`server/routes/interactions.ts`) — unchanged regardless of payload
type. Confirmed six live payload types on `dev` as of this session:
`decision-request/v1`, `feature-selection/v1`, `edit-proposal/v1`, `cba/v1`,
`free-text/v1`, `rating/v1`, `ranking/v1`. **None of these render an
image/SVG per option** — every existing answer shape is text-only. A "pick
one of N visual concepts" shape (logo concepts today; any future
image-backed design decision generalizes to the same shape) is a genuinely
new capability, not a rename of an existing one.

**`GET /api/docs/features` groups by `epic`, regardless of `phase`**
(confirmed live in phase28: a `phase: "design"` doc with a matching `epic`
folds into that feature's existing doc list with zero route change).
`overview` docs use `epic: null` since they're repo-wide, not tied to one
feature. Brand artifacts are also repo-wide (one brand system for the whole
project, not per-feature) — the same `epic: null` pattern applies.

**No mechanism exists today for a doc-scanner-indexed artifact to
auto-become a real decision.** The existing event pipeline
(`detectEvents`/`doc_changed`/`decision_needed` triggers) produces
*reviewable events* (diff + composed prompt), which can "graduate into a
real proposal on demand" per `VISION.md` — but a generic doc change is not
the same shape as "here are N named options, pick one," and nothing in the
current pipeline synthesizes a `decision_payload` from scanned content.
This is the real gap behind "we have the output already, now i just need to
make the decision" — Consus has no concept of a design artifact that
*carries its own decision* yet.

## 2. Concrete constraint: the concepts aren't machine-readable yet

`brand-guide.html`'s five logo concepts (pure wordmark, wordmark+symbol,
monogram, abstract mark, badge/seal) exist only as hand-authored inline SVG
markup inside the HTML page — there is no structured list anywhere (id,
name, description, renderable content) a server route could read to build a
`decision_payload` automatically. `brand-system.yaml`'s own
`concept_directions:` field (three short strings, e.g. `"monogram
counsel-arch"`) is a pre-generation *hint*, not a post-generation manifest
of what was actually produced.

For Consus to synthesize a real "pick one of N concepts" decision from this
artifact, a structured manifest needs to exist alongside the HTML — the
same shape of gap phase28 closed for wireframe images (`GET
/api/design-assets`, mirroring `attachments.ts`'s safety posture). This
epic's job is the Consus-side capability (manifest format + ingestion +
decision synthesis + viewing + the new answer shape) grounded in this real,
already-built artifact — not changes to the `/brand-system` or
`/logo-exploration` Hive skills themselves (a separate repo, out of scope
here; a follow-on note is left for whoever picks that up).

## 3. Reuse inventory (why this is still a reasonably-scoped epic)

- Scan-root pattern: exact precedent from phase27 (`OVERVIEW_ROOT_*`) and
  phase28 (`DESIGN_ROOT`) — a fourth scan root, same shape.
- Decision/verdict recording: zero changes needed — `POST
  /api/decisions/:id/verdict` already works for any payload type.
- `AnswerControl` dispatch pattern: proven six times, a seventh branch is
  additive, same shape as every prior one.
- iframe-isolated rendering is new, but bounded — one component, reusing
  the existing doc-content API to fetch the raw HTML string and render it
  via `srcdoc` (no new file-serving route needed, unlike phase28 s3's image
  route, since this is text content the doc-content API already serves).
