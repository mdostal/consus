# Design discussion — multi-repo scan + event pipeline

Status: design-discussion-only, no story decomposition, no code. Written against
`feat/consus-phase14-multirepo-event-pipeline`, research grounded in the actual code as of
`consus-phase13-multirepo-doc-resolution` (`e7f3e8a`/`c2d21f1`, merged via PR #95).

## Goal

Today an operator scans one project at a time: pick a project in `ProjectsSection`, click "Ingest
repo," and `POST /api/projects/:project/ingest` walks that one repo's `.pHive/planning/` and
`.pHive/epics/**`. Everything downstream (`GET /api/docs`, diagrams, KB) is scoped per-request to
one project or a flat union of all of them — there is no operation that sweeps every configured
project in one pass, and nothing that looks at what changed and decides it's worth a human's
attention.

The operator wants three connected things layered on top of that:

1. **Scan across every configured project in one action**, not one project at a time.
2. When that scan finds something worth reviewing — a doc that changed, or an unresolved
   decision-request — **produce a viewable, addressable "event"**: a record carrying the diff (or
   relevant doc delta), a composed prompt built from that diff plus the doc's surrounding content
   plus which project/area it came from, and a link back to the source. The event is reviewable
   and has a simple status the operator moves by hand (their example: "in progress").
3. A way to **navigate across all these areas** while doing this — the operator's floor suggestion
   is "replicate the file tree," which this doc evaluates rather than adopts outright (see
   "Cross-repo organization/navigation" below).

Explicitly not this epic: anything that fires a proposal at a harness automatically or integrates
with an external ticket system — deferred to a future Pantheon L2 ticket-adapter (see "Explicitly
out of scope" below).

## What already exists (the building blocks)

- **`server/config/project-registry.ts` + `server/routes/projects.ts`** — `loadProjectRegistry()`/
  `listProjects()` already return every configured project as a flat `{name: repoPath}` map
  (`GET /api/projects` exposes it); `POST /api/projects/:project/ingest` calls `scanRepo` for one
  project at a time. The registry isn't the gap — acting across all of it in one call is the gap.
- **`server/adapters/doc-scanner/index.ts`** — `scanRepo(db, {repoName, repoPath})` walks one
  repo's `.pHive/planning/` + `.pHive/epics/**`, hashes each doc, upserts `doc_index`; the
  `ON CONFLICT ... WHERE content_hash != excluded.content_hash` clause means a row only changes
  when content changed — the exact primitive change-detection needs. Per-repo already and
  stateless about "all repos" — the right unit to loop over, not rewrite.
- **`server/routes/docs.ts`**'s `GET /api/docs` — already returns *every* configured repo's doc
  index grouped `repo -> phase -> [{epic, file_path, content_hash, last_scanned_at}]` in one call
  (optional `?project=` narrows it) — a cross-repo, epic/phase-grouped tree already exists as a
  read model, relevant to the navigation question below; it just requires each repo be ingested.
- **`server/adapters/gitdocs/index.ts`** (this session) — `extractDocCandidates`/`resolveInRepos`/
  `readGitDoc` resolve a doc reference *found inside some text* to a concrete repo + file,
  ref-aware via `git show`. Narrower than the operator's "hop between repos and docs" phrase
  suggests — useful for resolving a pointer while composing an event's prompt, not a scanner.
- **`server/decision-contract/parser.ts` + `classifier.ts`** — `parseDecisionPayload` (3-tier
  structured/heuristic/none) and `classifyItem` exist but are unwired from any repo-scanning pass —
  items land in `items` only via `POST /api/decisions` or the KB/proposal flow, never by Consus
  reading a repo's files. "Read anything needing decisions" reads as: the scan should also grep
  doc content for a `decision-request` block (reusing `parseDecisionPayload`'s pattern) and, if
  found and undecided, treat it as an event trigger too — not just content-hash drift.
- **`server/proposals/store.ts`** + the `proposals` table — `pending`/`applied`/`failed`, always
  created by `proposeChange()`, which immediately dispatches via `transport.invoke(...)`. A
  `proposals` row's existence *is* "a dispatch was attempted"; no "detected but not yet decided to
  propose" state exists today.
- **`web/src/App.tsx`** — tabs are `decisions | projects | kb | docs`. `ProjectsSection` is the
  cross-project home ("All projects"/per-project nav, `GlobalView`'s flat KB list, `ProjectView`'s
  single-project KB list). `DocsSection` separately renders `GET /api/docs`'s grouping as its own
  tree — already a tree-like browser, in a different tab, neither surfacing "needs attention" today.

## Proposed approach

### 1. Multi-repo scan — NEW thin orchestration over REUSED `scanRepo`

Add a new route, e.g. `POST /api/projects/scan-all`, that loops `listProjects(repos)` and calls
the existing `scanRepo(db, {repoName, repoPath})` per project — no change to `scanRepo` itself.
Each repo's scan stays isolated (one repo's read error must not abort the others), and this loop
is also the natural place to run event-detection (below) right after each repo's scan completes,
since that's the moment "what changed since last scan" is knowable. Per the vision doc's
already-fixed **operator-triggered, not background** preference, `scan-all` is an additional
convenience alongside the existing per-project `ingest`, not a replacement and not a poll.

### 2. Event data model — NEW table, deliberately separate from `proposals`

This is the most consequential call in this design. `proposals` encodes "a diff was composed and
*dispatch to a harness was attempted*" — `pending` means "waiting on the harness to report back,"
not "waiting on a human to decide whether this is worth sending." Every `proposeChange()` call
immediately dispatches; no path creates a `proposals` row without also firing at the (possibly
no-op) harness. Retrofitting a pre-dispatch state means teaching every consumer of `proposals` (UI
polling, `reportProposalResult`, the audit-log write on `applied`) to treat a new status as inert,
or splitting `proposeChange()`'s one clear job in two — either way, quietly changing what a
`proposals` row means everywhere it's already read.

The operator's own framing supports keeping them apart: an event is "something that reads as
needing a decision," manually moved to "in progress" — a *review queue item* that may never become
a proposal at all, unlike a `proposals` row which always represents a completed or in-flight
dispatch. Conflating them puts "I'll look at this later" in the same table and status enum as an
actual harness dispatch — a category error, not a naming one.

**Recommendation: a new `events` table**, independent of `proposals`:

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,                     -- registry key
  trigger_kind TEXT NOT NULL,                -- 'doc_changed' | 'decision_needed'
  source_repo TEXT NOT NULL,
  source_path TEXT NOT NULL,                 -- doc_index.file_path
  content_hash TEXT NOT NULL,                -- doc_index.content_hash at detection time
  previous_hash TEXT,                        -- prior content_hash (doc_changed only)
  diff TEXT,                                 -- composed diff (doc_changed only)
  item_id TEXT REFERENCES items(id),         -- set when trigger_kind = 'decision_needed'
  composed_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'         -- 'new'|'in_progress'|'done'|'dismissed'
    CHECK(status IN ('new','in_progress','done','dismissed')),
  detected_at TEXT NOT NULL,
  status_updated_at TEXT NOT NULL,
  proposal_id TEXT REFERENCES proposals(id)  -- set only if graduated to a proposal
);
```

`proposal_id` is the deliberate seam: an event can *optionally* graduate into a real `proposals`
row (operator reads it, decides to act, fires the existing diff-compose flow with the diff
pre-filled) — reusing `proposeChange()` unchanged, without the event itself needing dispatch
semantics. This satisfies "standalone mode: click to say it's in progress" with a status enum that
has no notion of a harness, and leaves room for a future Pantheon L2 adapter to set `proposal_id`
automatically instead of a human click, without Consus building that itself.

### 3. Trigger conditions — precise, not hand-waved

A scan of one project produces zero or more events, from two trigger kinds:

- **`doc_changed`**: after `scanRepo` upserts a `doc_index` row, if its `content_hash` differs
  from what it was immediately before this scan (read the prior hash before the upsert runs),
  create an event. A brand-new file (no prior row) also counts — `previous_hash` is `NULL`, and
  the "diff" is the full content presented as an addition.
- **`decision_needed`**: after reading a doc's content during the scan, run
  `parseDecisionPayload()` against it. If it finds a `decision-request` block with no existing
  undecided `items` row tracking it, create an event (or refresh the existing open one). Reuses
  the parser as-is; doesn't require full `classifyItem` triage on every doc, only ones matching.

NOT a trigger: a doc that scanned identically to last time — re-scanning an unmodified tree
produces zero new events, mirroring `scanRepo`'s no-op-on-unchanged-hash behavior.

### 4. Prompt composition — concrete shape

Composed server-side at detection time (not regenerated on view) and stored verbatim in
`events.composed_prompt`, so what the operator reviewed is what was actually captured:

```
# Event: <trigger_kind> in <project> — <source_repo>/<source_path>

## Project / area
project: <registry key>  repo: <source_repo>  path: <source_path>
epic/phase (if under .pHive/epics/**): <epic>, <phase>

## What changed
<doc_changed: unified diff between prior content (via readDocContent/readGitDoc against the
last-known hash's git blob, else "no prior content on record") and the new content, plus one line
on why it was flagged: "content_hash changed since last scan">
<decision_needed: the raw decision-request block plus its parsed title/context/options/recommended,
plus: "unresolved decision-request block, no decided_at">

## Surrounding doc content
<full current doc content, or — if large — the section containing the change, reusing
web/src/features/docs/sections.ts's heading-delimited section logic, so a reviewer has context
without leaving the event>
```

Mirrors the operator's own list almost verbatim ("the diff and prompt... based on the updated docs
for the diff and area and the doc").

### 5. Status lifecycle (standalone mode only)

`new -> in_progress -> done`, plus `dismissed` as a "reviewed, consciously set aside" terminal
state distinct from `done` — conflating them loses whether the underlying doc/decision still needs
eyes. All transitions are manual HTTP calls (`PATCH /api/events/:id/status`) — never automatic,
never touching `proposals` or `HarnessTransport`.

### 6. Cross-repo organization/navigation — extend existing views, not a new file-tree subsystem

The operator's "even if it is just a replication of the file tree" is their floor, not a mandate.
`GET /api/docs` **already is** a repo → phase → epic/file tree across every project, rendered by
`DocsSection`; `ProjectsSection` already has the "All projects / pick one" pattern the operator
wants for hopping between repos. A literal new file-tree UI would substantially duplicate both.

**Recommendation**: add an **events view** reusing the existing grouping shape — an "All events"
list (cross-project, filterable by `status`) plus per-project scoping, matching how
`ProjectsSection`/`DocsSection` already scope by project. `GET /api/events?project=&status=`
mirrors `GET /api/docs`'s own `?project=` convention — satisfying "organize them somehow" without
rebuilding a file-tree widget that already exists elsewhere. Divergence flagged explicitly: they
suggested the file tree itself as the organizing structure; this organizes *events* by the same
project grouping as a list/queue view instead. A badge on `DocsSection`'s tree nodes ("has an open
event") is a legitimate smaller follow-on if wanted after this ships — not built speculatively now.

## Explicitly out of scope, and why

- **The Pantheon ticket-adapter auto-fire path.** The operator's own words: "when running in a
  paired mode in the pantheon, that'll be done with a ticket adapter and auto fire." This epic
  stops at detect → compose → display → manual status; the `events` design leaves that integration
  as a future consumer of `GET /api/events`/`proposal_id`, not something built here — consistent
  with Consus having no adapter directory for any specific external system.
- **A literal file-tree UI widget as a new subsystem.** The existing `GET /api/docs` tree plus a
  project-scoped events list covers the actual goal without a large new UI investment — a
  separable follow-up if the operator disagrees after seeing it, not a blocker to this epic.
- **PR/branch-level surfacing** (backlog's "PR/branch-level surfacing" theme). Real overlap in
  spirit with this request's event-review framing, but that item scopes docs/CBAs to an open
  PR/branch specifically, needing its own ref-aware scanning story (likely building on
  `readGitDoc`'s `ref` param) and is explicitly `backlogged`/`priority-later` — this design does
  not fold it in.
- **Re-classifying every scanned doc through `classifyItem`/triage on every scan.** The
  decision-parser reuse above is narrow (only docs matching the decision-request pattern); full
  triage classification in the scan loop is a bigger change, left to whoever picks up that
  backlog item separately.

## Risks

- **Scan cost at scale.** `scan-all` is O(projects × files under each repo's scan roots), each a
  full read + SHA-256 hash — fine for a handful of projects, but dozens of large repos could
  eventually need a per-repo timeout/skip or a background job with progress polling.
- **Stale prompt content if scan cadence lags real repo state.** An event's captured diff/prompt
  reflects the last scan, not the live working tree — surface a "detected at" timestamp rather
  than presenting it as current.
- **Unbounded `events` growth + duplicate/thrashing events.** Nothing deletes/expires events
  automatically — `done`/`dismissed` rows persist forever, likely at higher volume than
  `proposals`. A doc oscillating between states (e.g. branches syncing) could also produce a fresh
  `doc_changed` event each scan while a prior one on the same path is still open.
- **UI complexity.** Even reusing `GET /api/docs`'s grouping shape, a new events list/queue is real
  surface area — filtering, viewer linking, a clean propose-a-change handoff — the piece most
  likely to expand once built.

## Open questions — resolved by the operator

1. **Scan trigger model — RESOLVED: all three granularities coexist.** `scan-all` (new), the
   existing per-project `POST /api/projects/:project/ingest`, and one-off/ad-hoc scans all stay
   available side by side — `scan-all` is additive, not a replacement for anything.
2. **Event staleness handling — not explicitly resolved, defaulting conservatively.** No auto-
   transition/refresh: an open event sits until a human acts on it (sets status, or a fresh scan
   creates a new event referencing the same path if it drifts further — never silently mutates an
   existing open event's stored diff/prompt out from under a reviewer). Revisit if this proves
   noisy in practice.
3. **Retention — RESOLVED: archival history.** `done` events (and, by the same logic, `dismissed`
   ones) move to an archive rather than staying mixed into the active queue or being deleted.
   Modeled as an `archived_at` timestamp on the same `events` row (not a physically separate
   table/copy) — `GET /api/events` excludes archived rows by default; a distinct
   `GET /api/events/history` (or `?archived=1`) surfaces them. Cheapest correct implementation:
   one query-shape difference, not a second table to keep in sync.
4. **Decision-needed detection scope — not explicitly resolved, defaulting to existing scan
   roots.** Stays limited to `doc-scanner`'s current `SCAN_ROOTS` (`.pHive/planning/`,
   `.pHive/epics/**`) for this epic. Broader-repo scanning is a bigger, separate change (also
   affects `doc_changed` volume, not just `decision_needed`) — revisit as its own story if the
   operator wants it once this ships.

## Additional scope added by the operator (beyond the original ask)

- **Sort / organize / order the events + docs views.** The events list (and, where relevant, the
  existing docs tree) needs real sort/order controls — not just the project-scoped filter already
  designed above. At minimum: sort by `detected_at` (newest/oldest), `status`, and `project`;
  `GET /api/events` gains `?sort=` / `?order=` params following the same query-param convention as
  its existing `?project=`/`?status=` filters.
- **Find/search across all docs.** A cross-repo text search over `doc_index` (title/path today;
  content would need either storing doc content or re-reading each file at search time — the
  latter is simpler and consistent with "read live off disk" elsewhere in Consus, e.g.
  `GET /api/docs/content`). Scope this epic's search to what `doc_index` already has indexed
  (path/repo/phase) plus a live grep-on-demand for content matches, rather than building a new
  full-text index table — a heavier search infrastructure is a reasonable future upgrade, not a
  blocker here.
- **Fire off actions directly from the events/docs view.** An event's "graduate to a proposal"
  action (already designed above via `proposal_id`) should be reachable directly from the
  events list/queue UI, not require navigating to a separate doc/diagram view first — the compose
  form pre-fills from the event's already-stored diff + description context.

## Scale assessment

**Medium-to-Large.** Not a thin epic. It touches a new orchestration loop across every configured
project (small alone, but where event-detection hooks in); a new data model with real design
stakes (the events-vs-proposals question, decided here, but still a new table, routes, status
lifecycle); prompt composition deterministically combining several existing modules (`doc-scanner`,
`gitdocs`, `decision-contract/parser`, likely `docs/sections.ts`); and a new UI surface (an events
list/queue, wired to status transitions and a graduate-to-proposal handoff into
`POST /api/proposals`). No individual piece is large alone — each reuses an existing, tested
building block — but the integration surface is larger than any epic shipped this session so far
(`consus-phase13-multirepo-doc-resolution` was three pure functions, no new table, no new UI view,
for comparison). Recommend splitting stories along the section boundaries above — scan
orchestration + schema first, since prompt composition and UI both depend on events existing; UI
last.
