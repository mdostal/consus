# Consus API Reference

Every route Consus's server registers, kept current through `consus-phase21-codex-cli-support`
(v0.11.0). A harness author should be able to use Consus from this doc alone, without reading
source. All routes are relative to the server's base URL (default `http://localhost:8722`,
override via `PORT`/`HOST`).

Consus is fully standalone — the server has zero live network coupling to any other system. It
reads and writes only local SQLite (`server/db/`) and the local filesystem (doc scanner, epic/story
YAML). The one integration seam is `HarnessTransport` (`server/harness/transport.ts`), used by the
Proposals routes below: a generic `invoke(method, params)` call to whatever local command is
configured, with no knowledge of what's on the other end.

## Health

### `GET /health`
Confirms the server and SQLite connection are up.

**Response 200:**
```json
{ "status": "ok", "sqlite": "connected" }
```

## Projects

### `GET /api/projects`
Lists the configured project names (from `CONSUS_PROJECTS_CONFIG`, default
`.pHive/consus-projects.json`; defaults to `{ consus: <cwd> }` when no config file exists).

**Response 200:** `{ "projects": string[] }` — e.g. `{ "projects": ["consus"] }`.

### `POST /api/projects/scan-all`
Sweeps every configured project in one action — the same scan `POST /api/projects/:project/ingest`
runs, plus the same event-detection pass (`doc_changed`/`decision_needed`, see **Events** below),
applied per-project. A single project failing (e.g. a bad path) doesn't abort the sweep for the
rest.

**Response 200:**
```json
{ "results": [{ "project": "consus", "ok": true, "docsScanned": 21, "eventsCreated": 2 }] }
```
A failed project reports `{ "project": "...", "ok": false, "error": "..." }` instead of the counts.

### `POST /api/projects/:project/ingest`
Operator-triggered, on-demand scan: walks the project's `.pHive/planning/` and `.pHive/epics/**`
for `.md`/`.html` files and (re)populates `doc_index`, then runs the same event-detection pass
`scan-all` runs for every project (see **Events** below) — a doc that's new or changed since the
last scan, or an unresolved decision-request block, becomes a reviewable event. Not a background
poll — nothing scans automatically; this is the only way `doc_index` gets populated or refreshed.

**Response 200:** `{ "project": string, "docsScanned": number, "eventsCreated": number }`.
**404** if `:project` isn't a configured repo.

## Decisions (the queue an agent harness reads)

### `GET /api/decisions`
Plain local read — no external sync of any kind. Returns every item in the local `items` table
that carries a `decision_payload` (`dostal:decision-request/v1` shape — see
`server/decision-contract/parser.ts`). By default only the *open* queue (`decided_at IS NULL`) so
a harness never re-surfaces something already resolved (the decided-store amnesia fix). Pass
`?all=1` to additionally include already-decided items, ordered decided-last.

Items land in the `items` table via `POST /api/decisions` (below) or the propose-a-change
mechanism — there is no background or on-read sync from any external system.

**Response 200:** array of
```json
{
  "id": "consus:my-decision",
  "type": "decision_request",
  "title": "Ship v1 with the flex-scope KB backlog cut?",
  "status": "open",
  "source_repo": "consus",
  "source_body": null,
  "decided_at": null,
  "decision_payload": {
    "version": "dostal:decision-request/v1",
    "title": "...", "context": "...",
    "options": [{ "id": "A", "title": "...", "tradeoffs": "..." }],
    "recommended": "A"
  },
  "decision_type": "cba",
  "triage_bucket": "open_question"
}
```
`decision_type`/`triage_bucket` are populated by a heuristic classifier
(`server/decision-contract/classifier.ts`), wired into `GET /api/decisions` and
`POST /api/decisions`: rows that predate classification are classified on read
(opportunistic backfill, not a background job), and already-classified rows are
returned as-is.

### `POST /api/decisions`
Creates a new decision item — the counterpart to `GET /api/decisions` above. This is how an
outside agent/harness pushes a decision or CBA into Consus's queue; today's other write paths (the
KB store, the propose-a-change mechanism) are Consus-internal only. Stores what the caller
supplies — it does not compose or classify the payload itself.

**Request body:** `{ "id": string, "title": string, "source_repo"?: string, "decision_payload": DecisionPayload }`.
`id` is caller-supplied and required (never server-generated). `decision_payload` must already be
a valid `dostal:decision-request/v1` object: `version` exactly `"dostal:decision-request/v1"`,
`options` with at least 2 entries, `recommended` matching one of `options[].id`.

**Response 201:** the created item, same shape `GET /api/decisions` returns for it (`id`, `type`,
`title`, `status`, `source_repo`, `decided_at`, `decision_payload` parsed, `decision_type`,
`triage_bucket`).

**Response 400:** `{ "error": "<which field/rule failed>" }` — missing `id`, missing `title`, or
a `decision_payload` validation failure (wrong version, too few options, `recommended` not
matching an option).

**Response 409:** `{ "error": "item already exists: <id>" }` — no row is modified. A duplicate
`id` is never silently upserted; the caller owns its own idempotency/dedup scheme.

### `POST /api/items/:id/decide`
Submits a verdict on any item (not just decisions — any item with a `decision_payload`, or
without one). Writes an append-only `audit_log` entry and marks the item decided.

**Request body:** `{ "actor": string, "newStatus": string }`

**Response 200:** `{ "item": <full item row>, "auditLog": [<audit_log rows for this item>] }`.
**404** if the item doesn't exist.

### `POST /api/decisions/:id/verdict`
The web UI's structured alternative to the generic decide endpoint above: records one of four
verdict shapes and, for a reject, reopens the item (clears `decided_at`) instead of closing it —
the only path that puts a decision back into the open queue. Also appends a system comment
summarizing the verdict.

**Request body:** `{ "verdict": Verdict, "actor"?: string }` where `Verdict` is one of:
```json
{ "kind": "accepted" }
{ "kind": "option_chosen", "optionId": "A" }
{ "kind": "mix", "optionIds": ["A", "B"], "why": "..." }
{ "kind": "rejected_iteration_requested", "commentary": "..." }
```

**Response 200:** `{ "ok": true, "status": "done"|"in_progress", "decided_at": string|null }`.
**400** if `verdict`/`verdict.kind` is missing. **404** if the item doesn't exist.

## Comments

### `GET /api/items/:id/comments`
Lists an item's comment thread, oldest first.

**Response 200:** array of `{ id, author, body, createdAt }`

### `POST /api/items/:id/comments`
Appends a comment to an item's thread.

**Request body:** `{ "author"?: string, "body": string }` (`author` defaults to `"Mathew"`)

**Response 201:** `{ id, author, body, createdAt }`. **400** if `body` is empty/missing.

## Docs (generated briefs/PRDs/architecture/specs)

### `GET /api/docs?project=<name>`
Lists generated docs grouped `repo -> phase -> [doc]`, from whatever the most recent
`POST /api/projects/:project/ingest` populated into `doc_index` — this route never scans disk
itself. Omit `project` for every configured project (the global cross-project view); pass it to
scope to one.

**Response 200:**
```json
{
  "consus": {
    "planning": [{ "epic": null, "file_path": ".pHive/planning/prd.md", "content_hash": "...", "last_scanned_at": "..." }]
  }
}
```

### `GET /api/docs/content?repo=<name>&path=<file_path>&ref=<git-ref>`
Returns a specific doc's rendered content, read live off disk. Also upserts a target item
(`itemId`, e.g. `doc:consus:docs/api-reference.md`) so the doc always has something to target a
`POST /api/proposals` change proposal against — Consus never writes to the doc's source directly.

Optional `ref` reads the doc's content at that git ref instead of the working tree (`git show
ref:path`, via `execFileSync`'s argument-array form — no shell, immune to metacharacter
injection). **400** if `ref` doesn't resolve (bad ref, path not present at that ref).

**Response 200:** `{ "repo": string, "path": string, "format": "md"|"html", "content": string, "itemId": string, "ref"?: string }`
(`ref` present only when the request included one). **404** if `repo` isn't configured.

### `GET /api/docs/resolve?text=<free-form text>`
Given free-form text (e.g. a doc's prose), extracts path-shaped substrings and resolves each
against *every* configured repo — not just the one currently open — so a reference like
`server/adapters/foo.ts` found in one repo's doc can be traced to whichever configured repo it
actually lives in.

**Response 200:**
```json
{ "candidates": [{ "candidate": "server/adapters/foo.ts", "resolved": true, "repo": "consus", "path": "server/adapters/foo.ts" }] }
```
An unresolvable candidate reports `{ "candidate": "...", "resolved": false }` instead of `repo`/`path`.

### `GET /api/docs/search?q=<query>&project=<name>`
Cross-repo doc search — matches on file path and on live doc content (not just the last-indexed
snapshot). Omit `project` to search every configured repo; **400** if `q` is omitted. An empty
`scopedRepos` list (an unrecognized `project`) returns `{ "query": "...", "results": [] }`, not
an error.

## Knowledgebase

### `GET /api/kb-entries?project=<name>&q=<search>&collection=<name>`
Lists KB entries. All params optional and combinable: omit `project` for every project
(global view); omit `q` for no text filter (searches title + every *published* version's
content — draft content never leaks into search results); omit `collection` for every
collection. `collection` must be one of `marketing`, `boundary-decisions`, `plans`, `artifacts`,
`general` (`general` is the default for entries created without one) — an unrecognized value
returns `400`, not `500` or an empty/wrong result.

**Response 200:** array of `{ id, title, current_version_id, created_at, source_repo, collection }`

### `PUT /api/kb-entries/:id`
Creates or edits a KB entry directly, publishing immediately — every call appends a new
*published* version, never overwrites history.

**Request body:** `{ "author": string, "content": string }`

**Response 200:** `{ "ok": true }`

### `PUT /api/kb-entries/:id/draft`
Saves a draft version without publishing it — "Save ≠ Submit." A draft never appears in
`GET /api/kb-entries` search results and doesn't change `current_version_id` until explicitly
submitted (below).

**Request body:** `{ "author": string, "content": string, "title"?: string }`

**Response 200:** `{ "draft": <kb_versions row>, "currentVersionId": number|null }`

### `POST /api/kb-entries/:id/submit`
Explicitly promotes a draft version to published, via the same approval pipeline
(`server/kb/pipeline.ts`) `PUT /api/kb-entries/:id` uses internally.

**Request body:** `{ "actor": string, "versionId"?: number }` — omit `versionId` to submit the
most recent draft.

**Response 200:** `{ "ok": true, ... }`. **404** if the entry has no draft version (when
`versionId` is omitted) or `versionId` doesn't exist.

### `GET /api/kb-entries/:id/versions`
Full *published* version history for one entry, oldest first.

**Response 200:** array of `{ id, kb_entry_id, content, author, created_at }`

### `GET /api/kb-entries/:id/drafts`
Full draft version history for one entry, oldest first (drafts are kept even after one is
submitted, so this can show more than just the current unsaved draft).

**Response 200:** array of `{ id, kb_entry_id, content, author, created_at, ... }`

## Proposals (propose a change, fire it to a harness)

Consus never writes `.pHive`/repo content directly. Editing a diagram or a doc means composing a
diff + description and firing it to whatever `HarnessTransport` is configured
(`server/harness/transport.ts`) — a generic `invoke(method, params)` call with no knowledge of
what's on the other end. A harness applies the real change and reports back via
`POST /api/proposals/:id/result`. One route family shared by decisions, diagrams, and docs —
`targetType` is a label, never branched on server-side.

### `POST /api/proposals`
Fires a new change proposal.

**Request body:** `{ "itemId": string, "targetType": string, "diff": string, "description": string, "requestedBy": string }`

**Response 201:** the created proposal row, `status: "pending"` — or already `"failed"` with a
`failure_reason` if dispatch to the harness itself failed (e.g. no harness configured).
**404** if `itemId` doesn't reference an existing item.

### `POST /api/proposals/:id/result`
Called by the harness once it's actually applied (or failed to apply) the proposed change.

**Request body:** `{ "status": "applied"|"failed", "appliedDiff"?: string, "reason"?: string }`

On `"applied"`, writes an `audit_log` entry (`field: "proposal:<targetType>"`, `new_value` the
applied diff). On `"failed"`, no audit_log entry.

**Response 200:** the updated proposal row. **404** for an unknown proposal id.

### `GET /api/proposals?itemId=<id>`
Lists every proposal for an item, most recent first — pending, applied, and failed all included
(this is what the audit-trail panel surfaces).

**Response 200:** array of proposal rows. **400** if `itemId` is omitted.

**Harness transport config (env vars, server startup only):** `CONSUS_HARNESS_COMMAND` — if unset,
the server uses `NOOP_HARNESS_TRANSPORT` and every proposal resolves to `"failed"` immediately
with a clear reason (no startup error). If set, Consus spawns that command per proposal
(`StdioHarnessTransport`) and speaks one JSON object per line over stdin/stdout.
`CONSUS_HARNESS_ARGS` — comma-separated args for that command.

## Diagrams (epic/story cascade + architecture)

Both diagram kinds below are read-only over HTTP — read the current graph, edit it in the web UI's
React Flow canvas, then fire the change through the same `POST /api/proposals` every other edit
surface uses (`targetType: "diagram"`, `itemId` from whichever route below you're editing). There
is no diagram-specific write route; the diff sent is a plain text summary of the added/removed/
changed/moved nodes and edges, legible without the live graph.

### `GET /api/diagrams?repo=<name>`
The cascade org-tree for a repo: every epic under its `.pHive/epics/`, each with its stories'
id/title/complexity and dependency edges (`dependsOn`). Read-only, read live off disk on every
call (no ingest step needed for this route). A repo with no `.pHive/epics/` yet returns
`{ epics: [] }`, not an error. **404** for an unconfigured repo, **400** without `?repo=`.

Every fetch upserts a target item (`itemId`, e.g. `diagram:consus`) so the diagram always has
something to target a `POST /api/proposals` change proposal against. One item per repo's diagram,
not per epic/story node.

**Response 200:**
```json
{
  "repo": "consus",
  "itemId": "diagram:consus",
  "epics": [
    {
      "id": "epic-id",
      "title": "Epic Title",
      "stories": [
        { "id": "story-id", "title": "Story Title", "complexity": "medium", "dependsOn": ["other-story-id"] }
      ]
    }
  ]
}
```

### `GET /api/diagrams/:repo/architecture`
A second, independent diagram kind — a real per-repo architecture diagram derived from the repo's
actual directory structure (not planning docs), fully separate from the epic/story cascade above.
Generated fresh on every request (depth-2 walk, capped at 50 components, common build/vcs
directories ignored) — no cache table. Also folds in file-path-shaped mentions found in
`.pHive/epics/*/docs/design-discussion.md` files, best-effort (a malformed doc is skipped, never
a 500).

**Response 200:** `{ "repo": string, "topLevel": string, "fullComponent": string }` — both a
Mermaid `graph TD` source string, one shallow (top-level dirs only) and one richer (depth-2 plus
design-doc mentions). **404** with `{ "error": "unknown repo: <repo>" }` for an unconfigured repo
— the same shape the cascade endpoint above uses.

## Audit Trail (the shared history panel's data source)

### `GET /api/items/:id/audit-trail`
Every history entry for an item — plain `audit_log` writes (accept/mix/reject verdicts, KB
decides) merged with `proposals` (any status: pending/applied/failed) — most recent first.
One route for decisions, diagrams, and docs alike; no branching by item type. Each entry carries
a `kind: "audit" | "proposal"` so a caller never has to guess which kind of record it's looking
at from shape alone.

**Response 200:** array of
```json
[
  { "kind": "audit", "id": 1, "actor": "mathew", "field": "status", "old_value": "open", "new_value": "approved", "timestamp": "..." },
  { "kind": "proposal", "id": "uuid", "target_type": "diagram", "description": "...", "status": "applied", "requested_by": "mathew", "timestamp": "...", "applied_diff": "...", "failure_reason": null }
]
```

## Events (the pre-decision review queue)

An event is deliberately a different concept from a proposal: a proposal always means "fired at a
harness"; an event is a pre-decision review-queue item created by scanning (`doc_changed` — a
doc's content changed or is new; `decision_needed` — an unresolved decision-request block found in
a doc) that may never become a proposal. Every scan (`POST /api/projects/:project/ingest` or
`POST /api/projects/scan-all`) can create events.

### `GET /api/events?project=<name>&status=<status>&sort=<field>&order=<asc|desc>`
Lists active (non-archived) events. All query params optional. `status` must be one of `new`,
`in_progress`, `done`, `dismissed`; `sort` one of `detected_at`, `status`, `project`; `order` one
of `asc`, `desc`. **400** for an unrecognized value on any of them.

**Response 200:** array of event rows — `{ id, project, trigger_kind, source_repo, source_path,
content_hash, previous_hash, diff, item_id, composed_prompt, status, detected_at,
status_updated_at, archived_at, proposal_id }`. `trigger_kind` is `"doc_changed"` or
`"decision_needed"`; `diff` and `composed_prompt` are built once at detection time (diff +
surrounding doc content + area context).

### `GET /api/events/history?project=<name>&status=<status>&sort=<field>&order=<asc|desc>`
Same filters, same response shape as above, but scoped to **archived** events —
`done`/`dismissed` events are automatically archived out of the active queue `GET /api/events`
returns.

### `PATCH /api/events/:id/status`
Manual status lifecycle: `new -> in_progress -> done/dismissed`.

**Request body:** `{ "status": "new"|"in_progress"|"done"|"dismissed" }`

**Response 200:** the updated event row. **400** for an unrecognized status. **404** for an
unknown event id.

### `POST /api/events/:id/propose`
Graduates an event into a real proposal — reuses `POST /api/proposals`'s own `proposeChange`
mechanism unmodified, so a graduated event's proposal behaves identically to any other proposal
(same audit trail, same harness dispatch). The seam a future Pantheon L2 ticket-adapter would
consume for automatic dispatch in paired mode — deliberately not built here; this route is the
manual, standalone-mode path.

**Request body:** `{ "description": string, "requestedBy": string }`

**Response 200:** `{ event: <updated event row, now carrying proposal_id>, proposal: <the created
proposal row> }`. **400** if the event has no diff (nothing to propose), or if `description`/
`requestedBy` is missing. **404** for an unknown event id.

## Artifact Links

### `POST /api/items/:id/artifact-links`
Associates a claude.ai Artifact URL with an item — link only, Consus never re-renders the
Artifact's content.

**Request body:** `{ "url": string, "label"?: string }`

**Response 201:** `{ "ok": true }`

### `GET /api/items/:id/artifact-links`
Lists an item's linked Artifacts.

**Response 200:** array of `{ id, url, label }`
