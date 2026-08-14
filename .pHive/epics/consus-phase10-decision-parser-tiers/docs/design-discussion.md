# Design discussion: decision-request parser tiers

## Goal

`server/decision-contract/parser.ts` implements `parseDecisionPayload()` for
the `dostal:decision-request/v1` contract. `.pHive/planning/roadmap.md`
tracks this as REQ-23 ("Decision-Request Heuristic Fallback Tier"): port
`mdostal/delphi`'s real 3-tier parser (structured -> heuristic-from-markdown
-> none) — mainline was scoped as only implementing tier 1.

## Scope note — tier 1 and tier 2 are already implemented

Reading `parser.ts` and `parser.test.ts` on this branch shows REQ-23 is
**already shipped**: commit `bc0e8f6` ("REQ-23: Decision-request heuristic
fallback tier (#7)") added a full tier-2 heuristic fallback, with test
coverage for every option-shape pattern, the "nearest recommend" resolution,
the lowercase-checklist non-shadowing case, and the "no recommend line ->
null" / "fewer than 2 options -> null" negative cases. This predates this
epic folder's creation — no `.pHive/epics/*` artifact existed to document it
as planned/tracked work, which is the actual gap this epic closes. So this
document is retroactive in one sense (tiers 1 and 2 are real, working code,
not a proposal) and forward-looking in another: it identifies and scopes a
genuine remaining gap, described below.

## What tier 1 does (confirmed from parser.ts)

`FENCED_DECISION_REQUEST_BLOCK` matches a fenced ```` ```decision-request ````
block anywhere in arbitrary prose (or the whole input is tried as bare JSON
if no fence is found); the captured text is `JSON.parse`d and checked for
`version === "dostal:decision-request/v1"`, a `title`, `options.length >= 2`,
and a `recommended` letter. Any failure of that check — bad JSON, wrong
version, <2 options, missing `recommended` — falls through to tier 2 rather
than returning null immediately. This is the "structured" tier: the contract
is intentionally strict (options A-Z, tradeoffs per option, `recommended` is
non-optional — "agents must always take a position").

## What tier 2 does (per the documented reference and the shipped code)

`docs/delphi-lineage-inventory.md`, Source 2, `server/parse.mjs — the real
3-tier parser (structured -> heuristic -> none)`, documents the reference
implementation from `mdostal/delphi` as:

> The real implementation falls back to regex-extracted options from
> free-form markdown before giving up:
> - `#### Option A — title` / `Option A: title` headings
> - `A) TITLE: detail` lines
> - `**A — title**` (comparison-table cells)
> - "recommended" resolved from the first line matching `/recommend/i` that
>   names a known option letter

This is reasonably specific — it names the three literal option-shapes and
the general resolution rule for `recommended` — and the shipped
`extractHeuristicOptions()` / `extractRecommended()` in `parser.ts` implement
exactly those three patterns, tried in that order, first pattern to yield
2+ options wins. One place the doc is **not** fully specific: it doesn't say
how to resolve `recommended` when a `/recommend/i` line names *more than one*
known option letter (e.g. "we compared A and B but recommend B"). The
shipped code makes an explicit design call the doc doesn't itself spell out:
pick the option letter with the smallest character-distance from the
`recommend` keyword on that line, not the leftmost match. That's a reasonable
reading consistent with the doc's intent, but it's an implementation
decision beyond what the doc states, not something to treat as verified
against the original `parse.mjs` source (which wasn't itself re-read for
this epic — only the lineage doc's summary of it was). Flagging this rather
than asserting the port is byte-for-byte faithful.

## The actual remaining gap: no confidence signal on heuristic output

`parseDecisionPayload()` returns the exact same `DecisionPayload` shape
regardless of which tier produced it — there is no field anywhere on the
type that says "this was regex-guessed out of prose, not authored as a
structured decision." The single production call site,
`classifier.ts:100` (`const payload = item.decision_payload ?
parseDecisionPayload(item.decision_payload) : null;`), then treats any
non-null payload identically: `classifyDecisionType()` maps every payload to
`"cba"` (if `diagram: true`) or `"choose"`, and `heuristicTriageBucket()`
routes any non-`"default"` decision type straight to `"open_question"` —
the same as a carefully hand-authored structured payload. A heuristic guess
that happens to be wrong (see Risks) gets the same downstream trust as a
payload an agent deliberately composed.

## Approach

Add an optional `extractionTier?: "structured" | "heuristic"` field to
`DecisionPayload` (`parser.ts`). `parseDecisionPayload()`'s tier-1 path
leaves it unset (structured is the implicit default — no existing caller or
test should need to change for tier-1 payloads); `parseHeuristicPayload()`
sets `extractionTier: "heuristic"` on what it returns. No DB schema change
is needed — `items.decision_payload` is already a `TEXT` column holding
serialized JSON, so an added optional field round-trips for free through
`serializeDecisionPayload`/`JSON.parse`.

`classifier.ts` then reads that field: a heuristic-tier payload should not
receive the same automatic `"open_question"` promotion as a structured one.
Concretely, `heuristicTriageBucket()` should treat a heuristic-tier
`decisionType` as `"agent_task"` (the same conservative default as "no
payload at all") rather than `"open_question"` — i.e., a heuristic guess
gets a chance to be reviewed/corrected by an agent pass rather than being
immediately surfaced to a human as a confirmed decision request. This is the
justification for a field on the payload itself (vs., say, a second column
or a wrapper type): it keeps `classifyItem()`'s existing single read of
`item.decision_payload` sufficient, and it keeps the signal traveling with
the payload wherever it's serialized (API responses, future UI badges)
without a second lookup.

Alternative considered: a wrapper `{ payload, tier }` return type from
`parseDecisionPayload()` instead of a field on `DecisionPayload` itself.
Rejected — it would change the function's return type for every existing
caller and test (`parser.test.ts` asserts `.toEqual(SAMPLE_PAYLOAD)` and
reads fields like `.title`/`.options` directly off the result), for a
distinction only one caller currently needs. An optional field is additive
and backward compatible.

## Risks

- **Heuristic false positives.** The three regex shapes are generic enough
  to match structure that isn't actually a decision — e.g. a changelog with
  `A) Fixed timeout bug: ...` / `B) Updated dependency: ...` entries, or a
  numbered options list in an unrelated How-To doc that happens to also
  contain the word "recommend" nearby (a "we recommend restarting the
  service" troubleshooting note). The existing lowercase-checklist test
  guards one shadowing case but not this one. Lowering heuristic-tier
  confidence downstream (this epic's actual change) mitigates the *impact*
  of a false positive — it degrades to "another agent task to review," not
  an unreviewed decision surfaced as if a human vetted it — but does not
  reduce the false-positive *rate* itself.
- **Silent behavior change for any future caller** that reads
  `item.decision_type`/`triage_bucket` and assumed all `"choose"`/
  `"open_question"` items were structured. Today there's exactly one
  consumer (`classifier.ts`) so this is contained, but it's worth calling
  out for whoever adds the next consumer.

## Open questions

1. Should `extractionTier: "heuristic"` also surface in the web UI (e.g. a
   "heuristically detected — please confirm" badge on the item card), or is
   the triage-bucket downgrade sufficient for this epic? Left out of scope
   here — no UI file was read as part of this pass, and the roadmap doesn't
   currently carry a UI-facing REQ for this.
2. Is `"agent_task"` really the right downgraded bucket for a heuristic
   guess, or should there be a dedicated bucket (e.g. `"needs_confirmation"`)
   distinct from both "structured decision" and "no decision detected at
   all"? Adding a new `TriageBucket` variant is a larger, schema-adjacent
   change (the type is used in `triage_overrides` and UI rendering) — this
   doc recommends reusing `"agent_task"` for now precisely to keep the scope
   small, but flags it as a real judgment call, not a settled one.

## Scale assessment

Small. Two files touched: `parser.ts` (one new optional interface field,
one line in `parseHeuristicPayload`'s return) and `classifier.ts` (one
branch in `heuristicTriageBucket` keyed on `extractionTier`). No new routes,
no DB migration, no new dependencies. Standalone-only, consistent with
Consus's fixed no-live-coupling constraint — this is pure parsing/
classification logic, nothing touches an external system.
