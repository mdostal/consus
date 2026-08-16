# Design Discussion: consus-phase15-wire-decision-classifier

## Goal

`server/decision-contract/classifier.ts` exports a fully built, fully tested `classifyItem(db,
itemId)` — a heuristic decision-type + triage-bucket classifier — but no route ever calls it.
`VISION.md`'s "Good first contributions" section flags this explicitly: "Wire the decision
classifier — call `classifyItem` from the decisions routes so `decision_type`/`triage_bucket` are
populated instead of always `null`." Today, every item returned by `GET /api/decisions` (and
`POST /api/decisions`) has `decision_type: null, triage_bucket: null` regardless of content. This
epic closes that gap by calling the existing function from the existing write paths. No new
classification logic.

## What `classifyItem` already does

`classifyItem(db, itemId)` (`server/decision-contract/classifier.ts:105`) is not a pure function —
it already persists its own result:

1. Reads the item's `id, type, title, decision_payload` from `items`.
2. Parses `decision_payload` (if present) via `parseDecisionPayload`.
3. Computes `decisionType` — from the payload's `diagram` flag when a payload exists ("cba" vs
   "choose"), or from a title-regex heuristic fallback when it doesn't.
4. Computes `triageBucket` — `human_request` items get `open_question`; a non-default
   `decisionType` maps to `open_question` (tier-1/structured payload) or `agent_task` (tier-2/
   heuristic-extracted payload, via `payload?.extractionTier === "heuristic"`); everything else
   defaults to `agent_task`.
5. **Checks `triage_overrides` and lets a human-authored override win** over the heuristic bucket
   (`classifier.ts:116-119`) — this is already fully wired inside `classifyItem` itself. No
   separate wiring is needed for `triage_overrides`; the classifier already consults it on every
   call.
6. **Writes `decision_type`/`triage_bucket` back to the `items` row itself** (`UPDATE items SET
   decision_type = ?, triage_bucket = ? WHERE id = ?`, `classifier.ts:121-125`), then returns the
   `ClassificationResult`.

`extractionTier` (`server/decision-contract/parser.ts:42`, added earlier this session) is already
fully consumed — `heuristicTriageBucket`'s signature already takes `payload: DecisionPayload |
null` and branches on `payload?.extractionTier === "heuristic"` (`classifier.ts:100`). Confirmed
via `classifier.test.ts`'s two paired tests ("routes a heuristic-tier decision_payload ... to
'agent_task'" / "still routes a structured (tier-1) ... to 'open_question'"). Nothing to change
here.

## Where `items` rows get a `decision_payload`

Two real write paths, not three:

- **`POST /api/decisions`** (`server/routes/decisions.ts:107-110`) — validates a caller-supplied
  `decision_payload` and `INSERT`s a new item.
- **`server/events/detect.ts`'s `detectDecisionNeededForRow`** (lines 264-266) — the
  `decision_needed` event-detection pass; parses a doc's embedded `decision-request` block and
  `INSERT ... ON CONFLICT DO UPDATE`s an `items` row with it.

`server/kb/store.ts` was also flagged for research but turns out **not** to be a write path here —
its only `decision_payload`-adjacent function, `decideItem`, updates `status`/`decided_at` on an
existing item (approve/decide flow); it never creates or updates `decision_payload` itself.

## Write-time vs. read-time — recommendation: write-time

**Write-time: call `classifyItem(db, id)` immediately after each insert/upsert in the two paths
above.** Reasoning:

1. **`classifyItem` is already a write-time function, not a pure one.** It performs its own
   `UPDATE` as a side effect. Calling it from a `GET` handler would mean a "read" endpoint
   triggers a database write on every single request (once per row returned) — a side effect
   pattern no other route in this codebase has, and a surprising one for a `GET`.
2. **`GET /api/decisions`'s existing `SELECT` already includes `decision_type, triage_bucket` as
   plain stored columns** (`decisions.ts:68-69`), read alongside `id, type, title, status`, etc. —
   not computed inline. The route was already built assuming these are stored values populated
   elsewhere, which is exactly the write-time shape.
3. **The actual cost tradeoff is small either way** — `classifyItem` reads one row and a
   `triage_overrides` lookup, both indexed/keyed lookups — but write-time avoids re-running that
   work on every list-view render for data that hasn't changed, and keeps `GET` side-effect-free.
4. **Known limitation, accepted:** a future change to the classifier's heuristics won't
   retroactively reclassify already-written rows without an explicit backfill pass (e.g. a script
   that re-runs `classifyItem` over every item). That's out of scope for this wiring task — the
   same tradeoff `VISION.md`'s framing implicitly accepts by calling this a "good first
   contribution," not a data-migration project.
5. **One small addition to close the obvious gap left by (4) for *existing* data:** in
   `GET /api/decisions`, for any row where `decision_type IS NULL` (an item that predates this
   wiring, or that somehow never got classified), opportunistically call `classifyItem(db, id)`
   before returning it. This is not "recompute on every read" — already-classified rows are
   returned as-is, untouched — it's a narrow self-healing step scoped to exactly the rows this
   epic would otherwise leave permanently `null`. Without it, every item that existed in the
   database before this change ships stays unclassified forever, which defeats the point of the
   fix for anyone with an existing local Consus instance.

## Where the wiring goes

- `server/routes/decisions.ts`:
  - `POST /api/decisions` handler: call `classifyItem(db, id)` right after the `INSERT` (after
    line 110), before the follow-up `SELECT` that builds the response — the response row already
    selects `decision_type, triage_bucket`, so this makes the created-item response reflect
    classification with no separate response-shape change.
  - `GET /api/decisions` handler: after fetching `rows`, for each row with `decision_type === null`
    call `classifyItem(db, row.id)` and use the returned `ClassificationResult` to fill in the
    response row (avoiding a second `SELECT` round-trip per row).
- `server/events/detect.ts`: in `detectDecisionNeededForRow`, call `classifyItem(db,
  decisionItemId)` right after the `INSERT ... ON CONFLICT DO UPDATE` (after line 266) — this
  covers items created by the event-detection pass the same way the two decisions-route paths are
  covered, and re-classifies on content drift (a new/updated `decision_payload` for the same item
  id) since the pass re-runs classification every time it upserts.

## Risks

- **Existing tests could break if any assertion currently assumes `decision_type`/`triage_bucket`
  stay `null`.** Checked: `server/routes/decisions.test.ts` and
  `server/routes/decisions.all.test.ts` — neither asserts `decision_type`/`triage_bucket` at all
  (grepped both files; zero matches). The one test that could be sensitive,
  `"returns the created item in the same shape GET /api/decisions returns"`, uses
  `toMatchObject`, which only checks the fields it names — adding populated `decision_type`/
  `triage_bucket` to the response does not fail it. **No existing test needs to change to keep
  passing**, but the new story still adds an explicit assertion that these fields are populated
  post-wiring, so the behavior is pinned going forward rather than left implicit.
- **`triage_overrides` has no write-time route of its own** (`setTriageOverride` is exported but
  never called from any route today, same gap pattern as `classifyItem` itself). Out of scope here
  — `VISION.md`'s flagged gap is specifically about `classifyItem`, not about adding an
  overrides-management endpoint. Noted for a future story, not blocked on here.

## Open question

None significant. The one real design choice (write-time vs. read-time) has a clear answer given
the codebase's existing `SELECT` shape and `classifyItem`'s own write-time implementation; see
above.

## Scale

**Small.** Two call sites added to two existing files (`server/routes/decisions.ts`,
`server/events/detect.ts`), no schema change (`decision_type`/`triage_bucket` columns already
exist per `server/db/migrate.ts:160-161`), no new logic in the classifier itself. One story.
