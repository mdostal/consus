# Consus API Reference

Every route Consus's server registers, kept current through v0.17.2. `server/routes/api-reference.drift.test.ts`
fails CI if a route registered in `server/routes/*.ts` has no heading here. A harness author should be able to use Consus from this doc alone, without reading
source. All routes are relative to the server's base URL (default `http://localhost:8722`,
override via `PORT`/`HOST`).

By default Consus is standalone: it reads and writes only local SQLite (`server/db/`) and the
local filesystem (doc scanner, epic/story YAML), and makes no outbound network calls. The
integration seam is `HarnessTransport` (`server/harness/transport.ts`), used by the Proposals
routes below. Outbound HTTP happens only when you opt in with `PANTHEON_API_URL` /
`CONSUS_HARNESS=pantheon` — see [Harness transports](#harness-transports) and the verdict bridge
under `POST /api/decisions/:id/verdict`.

## Health

### `GET /health`
Confirms the server and SQLite connection are up. Always 200 while the process is serving;
`status` and `sqlite` are stable, so existing healthchecks (Tauri sidecar, Pantheon compose) can
keep matching on them.

**Response 200:**
```json
{ "status": "ok", "sqlite": "connected", "transport": "pantheon", "degraded": false }
```

- `transport`: the active harness transport: `pantheon`, `webhook`, `file`, `stdio`, `noop` (none configured)
  or `custom` (an injected transport).
- `degraded`: `true` only in Pantheon mode, when any sync direction's last failure is newer than its
  last success (see `pantheon.directions` under `GET /api/metrics`). Always `false` otherwise.

### `GET /api/metrics`
Operational snapshot for dashboards (Janus, Pantheon). Computed from SQLite on each request, with
no background work or caching.

**Response 200:**
```json
{
  "generated_at": "2026-09-27T12:00:00.000Z",
  "decisions": { "open": 2, "oldest_open_age_seconds": 7200 },
  "proposals": { "pending": 2, "oldest_pending_age_seconds": 3600, "failed_24h": 1, "applied_24h": 2 },
  "events": { "pending": 3, "in_review": 1 },
  "projects": [{ "name": "consus", "last_ingest_at": "2026-09-27T11:55:00.000Z", "doc_count": 2 }],
  "harness": { "transport": "pantheon" },
  "pantheon": {
    "degraded": true,
    "last_error": "pantheon down",
    "last_error_at": "2026-09-27T11:59:00.000Z",
    "last_error_direction": "question_pull",
    "directions": {
      "question_pull": { "last_success_at": null, "last_failure_at": "2026-09-27T11:59:00.000Z", "last_error": "pantheon down", "failing": true },
      "result_pull": { "last_success_at": "2026-09-27T11:59:00.000Z", "last_failure_at": null, "last_error": null, "failing": false },
      "question_push": { "last_success_at": null, "last_failure_at": null, "last_error": null, "failing": false },
      "decision_push": { "last_success_at": null, "last_failure_at": null, "last_error": null, "failing": false },
      "needs_context_push": { "last_success_at": null, "last_failure_at": null, "last_error": null, "failing": false }
    },
    "undelivered_answers": { "pending": 0, "failed": 1, "oldest_age_seconds": 300 }
  }
}
```

- `decisions.open`: items with a `decision_payload` and no `decided_at` (the same queue
  `GET /api/decisions` returns). Ages are whole seconds, or `null` when nothing is queued.
- `proposals.failed_24h` / `applied_24h`: count by `resolved_at` within the last 24 hours.
- `events.pending` / `in_review`: events with status `new` / `in_progress`.
- `projects[]`: every registered project, plus any repo with indexed docs. `last_ingest_at` is
  when the project was last scanned (ingest or registration), whether or not any doc changed.
  It is `null` if the project has never been scanned since this field was added.
- `pantheon` is present only when `CONSUS_HARNESS=pantheon`. Directions: `question_pull`
  (`GET /api/feed/questions`), `result_pull` (`GET /api/feed/changes`), `question_push` (question
  partial/submit), `decision_push` (`POST /api/events/decisions`), and `needs_context_push`
  (`POST /api/events/decisions/needs-context`, see `POST /api/decisions`). They're kept in the
  `sync_status` table, so they survive restarts. A non-2xx response counts as a failure, with
  the HTTP status in `last_error`. `question_push` is recorded per delivery attempt from the
  question-answer outbox (`question_deliveries`).
- `pantheon.undelivered_answers`: outbox rows with status `pending` / `failed`, and the age of the
  oldest one not yet delivered (`null` when the outbox is drained). Retry them with
  `POST /api/questions/redeliver`.

## Projects

### `GET /api/projects`
Lists the configured project names (from `CONSUS_PROJECTS_CONFIG`, default
`.pHive/consus-projects.json`; defaults to `{ consus: <cwd> }` when no config file exists).

**Response 200:** `{ "projects": string[], "paths": Record<string, string> }` — `paths` maps every
registered project name to its absolute repo path on disk (same map `CONSUS_PROJECTS_CONFIG`
loads into), e.g.:
```json
{ "projects": ["consus"], "paths": { "consus": "/Users/example/repos/consus" } }
```

### `GET /api/projects/discover`
> **Loopback-only.** Built directly on `GET /api/fs/list`'s exposure category (see its callout
> below) — it reads filesystem structure beyond registered projects via the same
> `listSubdirectories` primitive. Same guidance applies: fine on the default `HOST=127.0.0.1`
> binding, not safe to expose on `HOST=0.0.0.0` without your own auth/network controls in front.

Zero-configuration repo discovery. Resolves candidate root directories from two sources: (a) the
parent directory of every already-registered project's path (e.g. once `consus` is registered at
`/Users/x/work/pantheon/consus`, siblings under `/Users/x/work/pantheon/` become free candidates),
and (b) `CONSUS_DISCOVERY_ROOTS` — an optional, comma-separated list of absolute paths (same
comma-split convention as `CONSUS_HARNESS_ARGS`). For each resolved root, lists its immediate
subdirectories (reusing `GET /api/fs/list`'s `listSubdirectories` directly — no duplicated
readdir/isRepo logic), filters to entries where `isRepo` is `true` and the path isn't already
registered, and returns the deduplicated result.

**Response 200:** `{ "candidates": [{ "name": string, "path": string }] }`. Returns
`{ "candidates": [] }` (never an error) when no roots resolve to anything — e.g. an empty registry
and no `CONSUS_DISCOVERY_ROOTS`.

### `POST /api/projects`
Registers a new project: names it, points it at a repo path on disk, persists that to
`CONSUS_PROJECTS_CONFIG` so it survives a restart, and immediately runs the same scan
`POST /api/projects/:project/ingest` does.

**Body:** `{ "name": string, "path": string }` — `name` may only contain letters, numbers, `-` and
`_` (it doubles as a URL segment and part of internal item ids); `path` is resolved to an absolute
path and must exist on disk.

**Response 201:** `{ "project": string, "path": string, "docsScanned": number, "eventsCreated": number }`.
**400** for a missing/invalid `name` or `path` that doesn't exist. **409** if `name` is already
registered, or if the resolved `path` is already registered under a *different* name (found live:
registering the same repo under two names silently produced duplicate decisions, one per name,
since decision ids are `decision:<project-name>:<file-path>` — this is a real path-identity check,
not just a name check).

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

### `GET /api/projects/:project/branches`
Lists a registered project's local and remote-tracking branches (`git for-each-ref refs/heads
refs/remotes`, `*/HEAD` symrefs excluded, sorted). Backs the web UI's branch picker. A repo with
no other branches (or where git fails) returns an empty list rather than an error.

**Response 200:** `{ "branches": string[] }`, e.g. `{ "branches": ["dev", "main", "origin/dev"] }`.
**404** if `:project` isn't a configured repo.

### `GET /api/fs/list?path=<dir>`
> **Loopback-only.** Unlike every other route in this reference, this one reads filesystem
> structure beyond any project the operator has explicitly registered — it will list whatever
> directories the server process can see, not just registered-repo paths. It's intended for the
> default `HOST=127.0.0.1` binding (server/index.ts), where only processes on the same machine can
> reach it. Do **not** expose this route on a `HOST=0.0.0.0` containerized deploy without adding
> your own auth/network controls in front of it.

Lists `path`'s immediate subdirectories only — one level, not recursive, not files. A caller
wanting to go deeper calls again with a returned subdirectory `path`. Each entry reports whether it
looks like a repo (`.git` or `.pHive` present directly inside it), as a hint only — this route never
filters on it. `path` is resolved with the same `resolve()` + `existsSync` + `statSync` validation
`POST /api/projects` uses; a raw value containing a `..` segment is rejected before resolution ever
runs. A subdirectory entry that can't be stat'd (permission denied, broken symlink) is silently
omitted rather than failing the whole listing.

**Query:** `path` (optional) — absolute or relative directory path. Defaults to the OS home
directory (`os.homedir()`) when omitted.

**Response 200:** `{ "path": string, "entries": [{ "name": string, "path": string, "isRepo": boolean }] }`.
**400** if `path` doesn't exist, isn't a directory, or contains a `..` segment.

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
  "triage_bucket": "open_question",
  "survey_id": null,
  "supporting_material_count": 0,
  "needs_context_requested_at": "2026-10-08T05:00:00.000Z"
}
```
`supporting_material_count` is live attachments + artifact links + research sections that cite at
least one source + a `doc` pointer (1). The web shell shows a "No context attached" warning when
it is `0`. `needs_context_requested_at` is when Consus sent `decision:needs-context` for the item
(see `POST /api/decisions`), or `null` if it never did; the warning then reads "Research requested
<time>", and disappears once material arrives.
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
a valid object of one of eight supported `version`s (`server/decision-contract/parser.ts`):
- `"dostal:decision-request/v1"` — `options` with at least 2 entries, `recommended` matching one
  of `options[].id`.
- `"dostal:feature-selection/v1"` — `features` with at least 1 entry.
- `"dostal:edit-proposal/v1"` (s4-edit-and-cba-answer-shapes) — `original` and `proposed` plain-text
  strings; the diff is computed by the renderer, not shipped in the payload.
- `"dostal:cba/v1"` (s4-edit-and-cba-answer-shapes) — `options` with at least 1 entry, each
  `{ option: string, cost: string, benefit: string, notes?: string }`; renders as a structured
  comparison table only (no computation/recommendation engine).
- `"dostal:free-text/v1"` (s5-freetext-rating-ranking-answer-shapes) — `prompt`, a non-empty string;
  renders as a single open-ended text response control.
- `"dostal:rating/v1"` (s5-freetext-rating-ranking-answer-shapes) — `prompt` (non-empty string) and
  `scale: { min: number, max: number, labels?: Record<number, string> }` with `min` less than `max`;
  renders as a numeric rating scale, one button per value, using `labels[value]` where given.
- `"dostal:ranking/v1"` (s5-freetext-rating-ranking-answer-shapes) — `prompt` (non-empty string) and
  `items` with at least 1 entry, each `{ id: string, label: string }`; renders as a drag-to-reorder
  list (with an up/down-button fallback).
- `"dostal:concept-selection/v1"` (s2-concept-selection-answer-shape) — `concepts` with at least 1
  entry, each `{ id: string, name: string, description: string, preview: { kind: "svg", markup: string } }`;
  deliberately generalized ("pick one of N named options, each with a visual preview"), not
  logo-specific — `preview` is a discriminated union on `kind` so a future `"image"` variant is
  additive. Renders each concept's name, description, and SVG preview side by side with a Select
  action per concept, firing a `{ kind: "concept_selected", conceptId: string }` verdict.
  `preview.markup` must only ever be server/operator-authored SVG, never end-user input.

**Response 201:** the created item, same shape `GET /api/decisions` returns for it (`id`, `type`,
`title`, `status`, `source_repo`, `decided_at`, `decision_payload` parsed, `decision_type`,
`triage_bucket`).

**Response 400:** `{ "error": "<which field/rule failed>" }` — missing `id`, missing `title`, or
a `decision_payload` validation failure (wrong version, too few options, `recommended` not
matching an option).

**Response 409:** `{ "error": "item already exists: <id>" }` — no row is modified. A duplicate
`id` is never silently upserted; the caller owns its own idempotency/dedup scheme.

**Missing context is warn-only (PANT-938).** A decision with no supporting material (the
`supporting_material_count` rule above) is always created and listed — never blocked or hidden.
When `PANTHEON_API_URL` is set, Consus also sends a fire-and-forget
`POST {PANTHEON_API_URL}/api/events/decisions/needs-context` with
`{ "decision_id", "survey_id", "title", "source_repo", "missing": ["research", "attachments", "doc"] }`
and stamps the item's `needs_context_requested_at`. It is sent at most once per item, with no
retry loop or timer; a failed delivery is recorded as `needs_context_push` in
`GET /api/metrics`' sync status and is not resent. Standalone mode (no `PANTHEON_API_URL`) sends
nothing. The 201 response carries `supporting_material_count` and `needs_context_requested_at`.

### `PATCH /api/decisions/:id/context`
Fixes or fills a decision's context after it was created (PANT-937). Replaces whichever of
`research`, `doc` and `context` the body carries in `decision_payload`; omitted fields are left
as they are, and `doc: null` removes the pointer. Only while the decision is unanswered: once a
verdict has decided it (`decided_at` set), the context it was answered against is frozen.

**Request body:** `{ "research"?: ResearchSection[], "doc"?: { repo, path, ref? } | null, "context"?: string, "actor": string }`
where `ResearchSection` is `{ "title": string, "body": string, "sources"?: string[] }`. A research
section that cites at least one source counts toward `supporting_material_count`, as does a `doc`
pointer, so filling them in clears the "No context attached" warning.

Writes one `audit_log` row (`field: "decision_context"`, `old_value`/`new_value` the edited
fields as JSON before and after).

**Response 200:** the updated decision, same shape as `GET /api/decisions` returns for it.
**400** without `actor` or with none of `research`/`doc`/`context`. **404** for an unknown
decision. **409** if the decision is already answered. **422** for an invalid `research`, `doc`
or `context` shape (nothing is written).

### `POST /api/items/:id/close`
The generic close (PANT-937): `:id` is a decision id, which closes that decision, or a survey id,
which closes every open member of the survey. Like `POST /api/questions/:ticket/close`, nothing is
deleted: each closed item gets `status: "closed"`, an `audit_log` row (`field: "status"`,
`old_value` the prior status, `new_value: "closed"`), and a comment `Closed: <reason>`.
Already-decided and already-closed items are left alone. Closed items drop out of the pending
`GET /api/decisions` queue (still listed under `?all=1`), and a verdict on one returns **409**.

**Body:** `{ "reason": string, "actor": string }`

**Response 200:** `{ id, kind: "item" | "survey", closed_item_ids }`. A repeat call is a no-op
that returns 200 with `closed_item_ids: []`. **400** without `reason` or `actor`. **404** if `:id`
is neither an item nor a survey.

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
{ "kind": "features_selected", "selected": ["dark-mode", "oauth"] }
{ "kind": "text_response", "text": "..." }
{ "kind": "rated", "value": 4 }
{ "kind": "ranked", "order": ["item-a", "item-b"] }
{ "kind": "concept_selected", "conceptId": "concept-a" }
```

**Response 200:** `{ "ok": true, "status": "done"|"in_progress", "decided_at": string|null }`.
**400** if `verdict`/`verdict.kind` is missing, or if the item is question-linked and the verdict
has no meaningful answer for it (`accepted` on anything other than a decision-request with a
`recommended` option, e.g. a feature-selection or free-text question). **404** if the item doesn't
exist.

**Verdict bridge (only when `PANTHEON_API_URL` is set).** After a verdict that decides the item
(anything except `rejected_iteration_requested`), Consus calls the Pantheon host without delaying
the response. The verdict is always recorded locally first and never changes the response.
- **Question-linked item** (created by the Pantheon question adapter from a pending question
  ticket, see [Harness transports](#harness-transports)): `POST {PANTHEON_API_URL}/api/feed/questions/:ticket/partial`
  with `{ "qid", "answer", "actor" }`. The first time every decision item in that ticket's survey
  is decided, a second call `POST {PANTHEON_API_URL}/api/feed/questions/:ticket/submit` with
  `{ "actor" }` closes the ticket. Submit is sent at most once per ticket (a later reopen and
  re-decide posts only a partial), and never while that ticket still has an undelivered partial.
  Both calls go through the `question_deliveries` outbox, written in the same transaction as the
  verdict: a non-2xx response or network error marks the row `failed` with `attempts` and
  `last_error`, and logs a warning with the ticket and qid. Failed rows are retried at server
  startup and by [`POST /api/questions/redeliver`](#post-apiquestionsredeliver).
- **Any other item**: `POST {PANTHEON_API_URL}/api/events/decisions` with
  `{ "decisionId", "title", "summary"?, "createdAt" }`. Question-linked items never take this path.

### `POST /api/questions/redeliver`
Retries every `pending` or `failed` row in the question-answer delivery outbox (see the verdict
bridge above), oldest first. Also runs once at server startup when `PANTHEON_API_URL` is set.
There is no background retry timer; call this to retry after the Pantheon host recovers.

**Response 200:** `{ "delivered": number, "failed": number, "skipped": number, "remaining": number }`
— `skipped` counts rows held back this pass (already in flight, or a submit waiting on an
undelivered partial); `remaining` is every row still not delivered afterwards.
**409** if `PANTHEON_API_URL` is not configured.

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

**Response 200:** `{ "repo": string, "path": string, "format": "md"|"html"|"mmd", "content": string, "itemId": string, "phase": string|null, "ref"?: string }`
(`ref` present only when the request included one). `phase` is the doc's current `doc_index`
tag (`planning`, `overview`, `brand`, `diagram`, …), or `null` if the working-tree file isn't indexed.
`format` is `mmd` for a standalone Mermaid diagram file (`.mmd`).
**404** if `repo` isn't configured or the file doesn't exist; **400** if `path` escapes the repo.

### `GET /api/docs/features?project=<name>`
The same `doc_index` rows as `GET /api/docs`, regrouped for the feature-review UI: one bucket per
epic, plus separate `overview`, `brand` (`.pHive/brand/**`) and `diagrams` (every `.mmd` file)
buckets. Omit `project` for every configured project. Never scans disk.

**Response 200:**
```json
{
  "features": [{ "epic": "consus-phase24", "docCount": 2, "docs": [{ "file_path": "...", "content_hash": "...", "last_scanned_at": "..." }] }],
  "overview": [{ "file_path": "...", "content_hash": "...", "last_scanned_at": "..." }],
  "brand": [],
  "diagrams": [{ "file_path": "docs/architecture/system.mmd", "content_hash": "...", "last_scanned_at": "..." }]
}
```

### `GET /api/docs/templates`
The starter templates for a new doc or diagram: `blank`, `adr`, `architecture-overview` (all
`.md`), and `mmd-flowchart`, `mmd-sequence` (`.mmd`).

**Response 200:** `{ "templates": [{ "id": string, "label": string, "kind": "doc"|"diagram", "extension": ".md"|".mmd", "content": string }] }`

### `POST /api/docs/new`
Proposes a new doc or diagram file. Consus does not create the file: it fires a change proposal
through the active harness transport, like any other edit, and the harness creates the file.

**Body:** `{ "repo": string, "path": string, "template"?: string, "content"?: string, "description"?: string, "requestedBy"?: string }`
— `path` is repo-relative and must end in `.md` or `.mmd`. `content` (when given) replaces the
template's starter text. `description` defaults to `Create <path>`.

The proposal targets item `doc:<repo>:<path>` with `targetType: "doc"`. Its diff marks a new
file: a `--- /dev/null` / `+++ b/<path>` header, then every line prefixed `+ `.

**Response 201:** `{ "repo": string, "path": string, "itemId": string, "proposal": <proposal row> }`.
**400** if `repo`/`path` is missing, `path` escapes the repo or has another extension, the
template is unknown or doesn't match the extension, or neither `template` nor `content` is given.
**404** if `repo` isn't configured. **409** if the file already exists or a proposal for that
path is still pending.

### `GET /api/docs/diff?repo=<name>&path=<file_path>&ref=<git-ref>&base=<git-ref>`
What changed in one doc on `ref` relative to `base` (`git diff <base>...<ref> -- <path>`).
`base` defaults to the repo's default branch, read from the local `refs/remotes/origin/HEAD`
symref; it is never assumed to be `main`.

**Response 200:** `{ "diff": string|null }` — `null` when the doc is identical on both refs.
**400** if `path` or `ref` is missing, a ref doesn't resolve, or `base` was omitted and the
default branch can't be determined. **404** if `repo` isn't configured or the doc doesn't exist
on one of the refs.

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

### Scan roots (what `doc_index` is actually populated from)
The doc scanner (`server/adapters/doc-scanner/index.ts`) walks four sources on every
`POST /api/projects/:project/ingest`: `.pHive/planning/**` (`phase: "planning"`, `epic: null`),
`.pHive/epics/<epic>/<phase>/**` (`epic`/`phase` derived from the path), repo-root
`README.md`/`VISION.md`/`docs/**` (`phase: "overview"`, `epic: null`), and — as of
`consus-phase28-interaction-completeness` — `.pHive/design/<topic>/**` (`phase: "design"`,
`epic: <topic>`, the topic directory name). The last of these is the Hive `/design` skill's
wireframe output directory, registered per-topic in `.pHive/design/index.yaml`
(`hive/references/wireframe-protocol.md`); only its `.md`/`.html` artifacts (e.g. `brief.md`,
`accessibility-constraints.md`) are indexed as docs — the `.f0`/`.png` wireframe files themselves
are served separately, see `GET /api/design-assets` below. A design topic whose name matches a
real feature's epic folds into that feature's existing doc group in
`GET /api/docs/features` (below), rather than appearing as a separate bucket. A repo with no
`.pHive/design/` directory is entirely unaffected — this scan root is purely additive.

Every `.mmd` file anywhere in the repo is indexed as a diagram (`phase: "diagram"`, `epic: null`),
skipping `.git`, `node_modules`, and build/vendor directories (`dist`, `dist-server`, `build`,
`coverage`, `target`, `vendor`, `.venv`, `venv`).

### Brand manifest decision synthesis (`.pHive/brand/logo-concepts.yaml`)
As of `consus-phase29-brand-decision-review` (s4), every scan (`POST /api/projects`,
`POST /api/projects/:project/ingest`, `POST /api/projects/scan-all`) also runs a brand-manifest
synthesis pass (`server/adapters/doc-scanner/brand-manifest.ts`'s `synthesizeBrandManifestDecision`,
called from `server/events/detect.ts`'s `detectEvents` — the same entrypoint every scan route already
shares) immediately after `scanRepo`. This is a different mechanism from the **Events** doc-scanned
`decision_needed` pass above: instead of surfacing a reviewable event, it synthesizes a real decision
item directly, so a design artifact that already carries its own set of named options (e.g. a set of
logo concepts) becomes something the operator can open and decide on in Consus without a
`decision-request` block ever needing to be hand-authored into a doc.

**Manifest format** — `.pHive/brand/logo-concepts.yaml`, a YAML object:
```yaml
version: dostal:concept-selection/v1
title: "Consus brand: select the logo concept direction"
context: "Five logo concepts were produced for Consus's first real brand system..."
concepts:
  - id: pure-wordmark
    name: Pure Wordmark
    description: "Consus set in Fraunces Bold — ..."
    preview:
      kind: svg
      markup: "<svg>...</svg>"
  # ... one entry per concept
```
`title`/`context` are required non-empty strings. `concepts` must have at least 1 entry, each
conforming exactly to `dostal:concept-selection/v1`'s `concepts[]` shape (`id`, `name`, `description`
all required non-empty strings; `preview.kind` must be `"svg"`; `preview.markup` a required non-empty
string, server/operator-authored SVG only — see `POST /api/decisions`'s concept-selection entry above
for the security note on `preview.markup`). `version`, if present in the file, is ignored — the
synthesized payload's `version` is always fixed to `"dostal:concept-selection/v1"` server-side, never
trusted from the file.

**Synthesis behavior:**
- No manifest on disk, a YAML parse failure, or a manifest that fails the shape validation above all
  degrade gracefully — no decision item is created or updated, and the scan itself never crashes
  (the same defensive posture as every other optional scan input in this codebase, e.g. a missing
  `.pHive/design/` directory).
- On a valid manifest, an `items` row is created with `id` following the exact same
  `decision:<repo>:<file_path>` scheme every other doc-derived decision uses (`server/events/
  detect.ts`'s `decisionItemIdFor`), keyed off the manifest's own repo-relative path
  (`.pHive/brand/logo-concepts.yaml`) — idempotent by construction: re-scanning resolves to the same
  id every time, never a duplicate row.
- Re-scanning an already-existing brand decision refreshes its `decision_payload`/`updated_at` from
  the manifest's current contents, but never clears `decided_at` — once the operator has recorded a
  verdict (e.g. `concept_selected` with `conceptId: "monogram"`, via `POST /api/decisions/:id/verdict`
  above), the decision stays decided across every future scan.

## Design Assets

### `GET /api/design-assets?repo=<name>&path=<repo-relative path>`
Serves an image asset (a wireframe rendition, e.g. `v1.png`) from a repo's `.pHive/design/`
tree — the one gap `GET /api/attachments/:id` doesn't cover, since attachments are keyed by an
opaque id in a DB table while design images are keyed by their repo-relative path on disk. Mirrors
`server/routes/attachments.ts`'s safety posture: an extension-based mime allowlist (`.png`,
`.jpg`/`.jpeg`, `.gif` — image types only, narrower than attachments' full allowlist), a
Content-Type always derived server-side from the extension (never trusted from any client input),
and `X-Content-Type-Options: nosniff`. `path` must resolve inside `<repo>/.pHive/design/` —
anything else (including a `../` traversal attempt) is rejected with **400**, not served.

**Response 200:** the raw image bytes, `Content-Type` set from the extension,
`Content-Disposition: inline`. **404** for an unconfigured `repo` or a `path` that doesn't exist
on disk. **400** for a disallowed extension or a `path` escaping `.pHive/design/`.

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

## Surveys (grouping decision items into a named batch)

A survey is a lightweight named container over existing decision items (rows with a non-null
`decision_payload`) — batching, say, every decision from one planning session so the UI can show
"3 of 7 answered" instead of a flat list. It does not create or change any decision itself.

### `GET /api/surveys`
Lists every survey with its member counts.

**Response 200:** array of
`{ id, title, description, created_at, total, answered }` — `total` counts member items with a
`decision_payload`; `answered` further restricts to `decided_at IS NOT NULL`.

### `POST /api/surveys`
Creates a named survey. Optionally assigns pre-existing decision items to it via `decision_ids`.

**Body:** `{ "title": string, "description"?: string, "decision_ids"?: string[] }`. An id in
`decision_ids` that doesn't exist, or belongs to an item with no `decision_payload`, is silently
skipped — not a 404 — keeping create+assign a single side-effect-free call.

**Response 201:** `{ id, title, description, created_at, members: [{ id, title, status, decided_at }] }`.
**400** if `title` is missing.

### `GET /api/surveys/:id`
Returns one survey and its current member decisions.

**Response 200:** `{ id, title, description, created_at, members: [...] }` (same member shape as
above). **404** if the survey doesn't exist.

## Questions (push-in seam for Pantheon question tickets)

The push half of the question seam: an external system (Pantheon) pushes a question ticket in, or
tells Consus the ticket was cancelled or answered elsewhere, over plain REST. The pull half is the
question adapter under [Pantheon transport](#pantheon-transport-consus_harnesspantheon); both
paths share one import function (`importQuestionTicket` in `server/pantheon/question-adapter.ts`),
so they write identical rows and each is idempotent against the other.

### `POST /api/questions/import`
Imports one question ticket as a survey with one decision item per question that maps to an answer
shape (`single-select` with ≥2 options → `dostal:decision-request/v1`, `multi` with ≥1 option →
`dostal:feature-selection/v1`, `free-text` → `dostal:free-text/v1`; anything else is skipped).

**Body:** `{ "ticket_id": string, "identifier"?: string, "questions": [{ "qid": string, "text": string, "kind": string, "options"?: string[] }] }`
— the same shape as one entry of Pantheon's `GET /api/feed/questions`.

**Response 201:** `{ ticket_id, survey_id, item_ids }` on first import. **200**
`{ ticket_id, survey_id }` if the ticket is already imported (by push or pull) — nothing is
written. **422** if no question maps to a decision shape. **400** for a missing `ticket_id` or
malformed `questions`.

### `POST /api/questions/:ticket/close`
Closes every still-open item linked to the ticket, for a ticket cancelled or answered outside
Consus. Nothing is deleted: each closed item gets `status: "closed"`, an `audit_log` row
(`field: "status"`, `old_value` the prior status, `new_value: "closed"`), and a comment
`Closed upstream: <reason>`. Already-decided items are left alone. Closed items drop out of the
pending `GET /api/decisions` queue (still listed under `?all=1`), and a verdict on one returns
**409**.

**Body:** `{ "reason": string, "actor"?: string }` — `actor` defaults to `"pantheon"`.

**Response 200:** `{ ticket_id, survey_id, closed_item_ids }`. A repeat call is a no-op that
returns 200 with `closed_item_ids: []`. **404** if no survey is linked to the ticket. **400**
without a `reason`.

## Proposals (propose a change, fire it to a harness)

Consus never writes `.pHive`/repo content directly. Editing a diagram or a doc means composing a
diff + description and firing it to whatever `HarnessTransport` is configured
(`server/harness/transport.ts`) — a generic `invoke(method, params)` call with no knowledge of
what's on the other end. A harness applies the real change and reports back via
`POST /api/proposals/:id/result`. One route family shared by decisions, diagrams, and docs —
`targetType` is a label, never branched on server-side.

**Transport selection** (env, mutually exclusive, first match wins — full detail under
[Harness transports](#harness-transports)):
- `CONSUS_HARNESS=pantheon` (requires `PANTHEON_API_URL`) — **Pantheon transport**. POSTs each
  proposal to the Pantheon board feed; results are pulled back automatically.
- `CONSUS_HARNESS=webhook` (requires `CONSUS_HARNESS_WEBHOOK_URL`) — **webhook transport**. POSTs
  each proposal to the URL; the receiver reports results via `POST /api/proposals/:id/result`.
- `CONSUS_HARNESS_FILE_DIR` — **file transport** (standalone, no Pantheon). Writes each proposal as
  `<dir>/<proposalId>.json`. A harness reads those files and posts results via `node bin/handoff.mjs`.
- `CONSUS_HARNESS_COMMAND` — **stdio transport**. Spawns the given command; `CONSUS_HARNESS_ARGS`
  (comma-separated) adds CLI arguments.
- _(none set)_ — NOOP transport. Proposals fail immediately with `NO_ADAPTER`.

### `POST /api/proposals`
Fires a new change proposal.

**Request body:** `{ "itemId": string, "targetType": string, "diff": string, "description": string, "requestedBy": string }`

**Response 201:** the created proposal row, `status: "pending"` — or already `"failed"` with a
`failure_reason` and `delivery_error` if dispatch to the harness itself failed (e.g. no harness
configured, or the webhook answered non-2xx). Such a proposal can be retried with
`POST /api/proposals/:id/redeliver`.
**404** if `itemId` doesn't reference an existing item.

### `POST /api/proposals/:id/result`
Called by the harness once it's actually applied (or failed to apply) the proposed change.

**Request body:** `{ "status": "applied"|"failed", "appliedDiff"?: string, "reason"?: string }`

On `"applied"`, writes an `audit_log` entry (`field: "proposal:<targetType>"`, `new_value` the
applied diff). On `"failed"`, no audit_log entry.

Only a `pending` proposal changes. The endpoint is safe to retry: reporting the same status again
for a proposal that is already resolved does nothing (no second `audit_log` row, `resolved_at` and
the diff/reason are left as they are) and returns the current row with 200.

**Response 200:** the updated proposal row, or the unchanged row for a repeated identical result.
**404** for an unknown proposal id. **409** if the proposal is already resolved with the other
status (`applied` then `failed`, or `failed` then `applied`). The row stays unchanged and the body is
`{ "error": "proposal <id> is already <status>; cannot report <status>" }`. A proposal whose
dispatch failed is already `failed`, so a later `applied` for it also gets 409.

### `POST /api/proposals/:id/redeliver`
Manual retry for a proposal whose dispatch never reached the harness (`status: "failed"` with
`delivery_error` set). Resets it to `pending` and dispatches the original payload once more
through the active transport. One attempt per call: Consus never retries on its own.

**Request body:** none.

**Response 200:** the proposal row after the attempt: `pending` with `delivery_error: null` when
delivery succeeded, or `failed` again with the new `delivery_error`. **404** for an unknown
proposal id. **409** when there is no delivery failure to retry (the proposal is pending, applied,
or failed by the harness's own report).

The audit-trail panel shows a **Retry delivery** button on such proposals that calls this route.

### `GET /api/proposals?itemId=<id>`
Lists every proposal for an item, most recent first — pending, applied, and failed all included
(this is what the audit-trail panel surfaces).

**Response 200:** array of proposal rows. **400** if `itemId` is omitted.

With no transport configured the server uses `NOOP_HARNESS_TRANSPORT` and every proposal
resolves to `"failed"` immediately with a clear reason (no startup error).

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

### `DELETE /api/items/:id/artifact-links/:linkId`
Removes one link (PANT-937), where `:linkId` is the numeric `id` from the list above. The link
row is deleted; an `audit_log` row (`field: "artifact_link"`, `old_value` the removed
`{ id, url, label }` as JSON, `new_value: null`) keeps the history.

**Request:** `actor` in the JSON body (`{ "actor": string }`) or as `?actor=<name>`.

**Response 204** (no body). **400** without `actor`. **404** if the link doesn't exist on this item.

## Attachments

Files attached to an item (decision, doc, …). Stored under `CONSUS_ATTACHMENTS_DIR` (default
`.pHive/attachments`).

### `POST /api/items/:id/attachments`
Uploads one file as `multipart/form-data`: a file part plus a required `actor` form field.
Allowed extensions: `.png .jpg .jpeg .gif .pdf .txt .md .csv .json .zip`, max 10 MB. The stored
`mime_type` is derived from the extension, never from the client.

**Response 201:** `{ "id", "item_id", "file_name", "mime_type", "size", "created_at" }`.
**400** if no file, the extension isn't allowed, or `actor` is missing. **404** if the item
doesn't exist. **413** if the file is too large.

### `GET /api/items/:id/attachments`
Lists an item's non-deleted attachments, oldest first.

**Response 200:** array of `{ id, item_id, file_name, mime_type, size, actor, created_at }`.

### `GET /api/attachments/:id`
Downloads an attachment's bytes with its stored `Content-Type` and `X-Content-Type-Options:
nosniff`. PNG/JPEG/GIF/PDF are served `inline`; everything else as `attachment`.

**404** if the attachment is unknown, deleted, or missing from storage.

### `DELETE /api/attachments/:id`
Deletes the stored file and tombstones the row (`deleted_at` set; it no longer appears in list or
download). Idempotent for an already-deleted attachment.

**Response 204** (no body). **404** if the attachment id was never known.

## Harness transports

Selected once at server startup from env (`selectHarnessTransport` in `server/index.ts`).
Mutually exclusive; the first match wins.

| Priority | Env | Transport | Behaviour |
|---|---|---|---|
| 1 | `CONSUS_HARNESS=pantheon` + `PANTHEON_API_URL` | Pantheon | `POST {PANTHEON_API_URL}/api/feed/changes` per proposal. Startup fails if `PANTHEON_API_URL` is missing. |
| 2 | `CONSUS_HARNESS=webhook` + `CONSUS_HARNESS_WEBHOOK_URL` | Webhook | `POST {CONSUS_HARNESS_WEBHOOK_URL}` per proposal, one attempt. Startup fails if the URL is missing or invalid. |
| 3 | `CONSUS_HARNESS_FILE_DIR=<dir>` | File | Writes `<dir>/<proposalId>.json`; a harness reads it with the handoff CLI below. |
| 4 | `CONSUS_HARNESS_COMMAND=<cmd>` (+ `CONSUS_HARNESS_ARGS`, comma-separated) | Stdio | Spawns the command per proposal, one JSON object per line over stdin/stdout. |
| 5 | _(none)_ | NOOP | Proposals fail immediately with `NO_ADAPTER`. |

### Proposal payload contract

The webhook, stdio, and file transports all carry the same `proposeChange` call. Webhook and stdio
send it as one envelope (webhook: the request body; stdio: one line on the child's stdin):

```json
{
  "method": "proposeChange",
  "params": {
    "proposalId": "3f6c0f1e-…",
    "itemId": "diagram:consus",
    "targetType": "diagram",
    "diff": "- old line\n+ new line",
    "description": "removed the load balancer node",
    "sourceRepo": "consus"
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `method` | `"proposeChange"` | The only method Consus sends today. |
| `params.proposalId` | string (UUID) | Proposal id. Use it to report back: `POST /api/proposals/:proposalId/result`. |
| `params.itemId` | string | The Consus item the change is for. |
| `params.targetType` | string | A label (`decision`, `diagram`, `doc`, …). Consus never branches on it. |
| `params.diff` | string | The proposed change. A new file (`POST /api/docs/new`) starts with a `--- /dev/null` / `+++ b/<path>` header. |
| `params.description` | string | Human-readable summary of the change. |
| `params.sourceRepo` | string \| null | The item's source repo, or `null` when it has none. |

The file transport writes `params` alone (pretty-printed) to `<dir>/<proposalId>.json`.

### Webhook transport (`CONSUS_HARNESS=webhook`)

For any receiver (Pantheon or anything else) that should get proposals pushed over HTTP:

- **Request.** `POST {CONSUS_HARNESS_WEBHOOK_URL}` with `Content-Type: application/json` and the
  envelope above as the body. 30-second timeout.
- **Accepted.** Any 2xx. The body is optional; if it is JSON with a `ticket_id` string, Consus
  stores it as the proposal's `harness_ticket_id`. The proposal stays `pending`.
- **Delivery failure.** A non-2xx, a timeout, or a network error. The proposal is set to `failed`
  with `failure_reason` and `delivery_error` both holding the cause, for example
  `INTERNAL_ERROR: HTTP 502: bad gateway`, `AUTH_FAILURE: HTTP 401`, `RATE_LIMIT: HTTP 429`,
  or `TIMEOUT: webhook did not respond: <url>`. There is one attempt and no retry loop: retry by
  hand with `POST /api/proposals/:id/redeliver` (the **Retry delivery** button in the history panel).
- **Results.** The receiver reports the outcome through `POST /api/proposals/:id/result`
  (`applied` / `failed`). Nothing is polled.

### Pantheon transport (`CONSUS_HARNESS=pantheon`)

Turning this on starts up to two pollers alongside the server, each every 60 seconds (the result
puller by default, the question adapter only with `CONSUS_PANTHEON_POLL=1` — see below):

- **Result puller** — `GET {PANTHEON_API_URL}/api/feed/changes?origin_god=consus&has_result=true&since=<cursor>`,
  and for each change with a result, records it exactly as `POST /api/proposals/:id/result` would
  (`applied`/`failed`). The cursor is stored in the `harness_cursors` table, so after a restart the
  first poll resumes from the last result seen. Any replayed result is a no-op.
- **Question adapter** — `GET {PANTHEON_API_URL}/api/feed/questions?status=pending&surface=decision`,
  and for each new pending question ticket, creates one survey with one decision item per
  question it can map to an answer shape. Answering those items sends partial/submit answers back
  (see the verdict bridge under `POST /api/decisions/:id/verdict`).

**`CONSUS_PANTHEON_POLL`** (default `0`). Unless it is `1` (or `true`) the question adapter doesn't
start, and question tickets arrive only through `POST /api/questions/import` /
`POST /api/questions/:ticket/close`.

**`CONSUS_PANTHEON_RESULT_POLL`** (default `1`). With `0` (or `false`) the result puller doesn't
start, and change results arrive only through `POST /api/proposals/:id/result`. It stays on by
default because Pantheon doesn't push change results yet.

A proposal on an item with no `source_repo` fails with `OPERATION_UNSUPPORTED`.

`PANTHEON_API_URL` on its own (without `CONSUS_HARNESS=pantheon`) still enables two outbound
calls: the verdict bridge, and a check in `POST /api/projects/:project/ingest` where a path shaped like
`<REPOS_BASE_DIR>/<tenant>/<repo>` (`REPOS_BASE_DIR` defaults to `/repos`) is first validated
against `GET {PANTHEON_API_URL}/api/repos/tenants/:tenant/repos/:repo/path`.

### Handoff CLI (file transport)

`bin/handoff.mjs` (also `npm run handoff`, or the `consus-handoff` bin) is the harness side of the
file transport:

```bash
node bin/handoff.mjs list                                # pending handoffs, with diffs
node bin/handoff.mjs result <proposalId> applied         # POST /api/proposals/:id/result, then delete the file
node bin/handoff.mjs result <proposalId> failed "reason"
```

Env: `CONSUS_HANDOFF_DIR` (default `.pHive/handoffs`; set it to the same dir as
`CONSUS_HARNESS_FILE_DIR`), `CONSUS_URL` (default `http://localhost:${PORT}`), `PORT` (default
`8722`).
