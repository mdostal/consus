# Consus API Reference

Every route Consus's server registers, as of `consus-phase2-survey-kb-api`. This is the
contract REQ-28 asks for — a harness author should be able to use Consus from this doc alone,
without reading source. All routes are relative to the server's base URL (default
`http://localhost:8722`, override via `PORT`).

Consus is dual-mode (standalone + Pantheon-plugin, per the project profile) — every route below
serves both modes identically. None is Pantheon-only.

## Health

### `GET /health`
Confirms the server and SQLite connection are up.

**Response 200:**
```json
{ "status": "ok", "sqlite": "connected" }
```

## Decisions (the queue an agent harness reads)

### `GET /api/decisions`
On every call, first syncs live issues from Multica (`s1-multica-live-ingest`) into the local
store, then lists every open, undecided item that either carries a `decision_payload`
(`dostal:decision-request/v1` shape — see `server/decision-contract/parser.ts`) **or** was
ingested from Multica (`id LIKE 'multica:%'`) — most real tickets don't carry the fenced
decision-request block, so both are included or the queue would show almost nothing.
`decision_type`/`triage_bucket` come from the heuristic classifier when there's no payload.
Excludes already-decided items (the decided-store amnesia fix — REQ-08) so a harness never
re-surfaces something already resolved. Returns `503` if the Multica sync itself fails, rather
than silently serving a stale/empty queue.

**Response 200:** array of
```json
{
  "id": "multica:i-1",
  "type": "multica_issue",
  "title": "Ship v1 with the flex-scope KB backlog cut?",
  "status": "todo",
  "source_body": "raw ticket description",
  "decision_type": "choose",
  "triage_bucket": "open_question",
  "decision_payload": {
    "version": "dostal:decision-request/v1",
    "title": "...", "context": "...",
    "options": [{ "id": "A", "title": "...", "tradeoffs": "..." }],
    "recommended": "A"
  }
}
```
`decision_payload` is `null` for a raw Multica issue with no fenced decision-request block.

**Multica connection config** (env vars, all optional — fall back to `~/.multica/config.json`,
the same file the `multica` CLI itself writes):
- `MULTICA_SERVER_URL` — REST base URL (used by the write-comment path only)
- `MULTICA_WORKSPACE_ID`
- `MULTICA_TOKEN`
- `MULTICA_PROJECT_ID` — scopes the sync to one Multica project (`multica project list` shows
  ids). Unset syncs the whole workspace, which is almost always too broad — set this per
  deployment. No config-file fallback; a workspace has many projects and there's no universal
  default.

### `POST /api/items/:id/decide`
Submits a verdict on any item (not just human_requests — any item with a `decision_payload`,
or without one). Writes an append-only `audit_log` entry and marks the item decided (REQ-08).

**Request body:** `{ "actor": string, "newStatus": string }`

**Response 200:** `{ "item": <full item row>, "auditLog": [<audit_log rows for this item>] }`

**Response 404:** `{ "error": "item not found: <id>" }`

> Note: the client-side verdict model (Accept/Option Chosen/Mix/Reject-iterate — see
> `web/src/features/decisions/answer-shapes/types.ts`) resolves to a single `newStatus` string
> before calling this endpoint; the server itself is verdict-shape-agnostic.

## Docs (generated briefs/PRDs/architecture/specs)

### `GET /api/docs?project=<name>`
Lists generated docs grouped `repo -> phase -> [doc]`. Omit `project` for every configured
project (the global cross-project view, REQ-27); pass it to scope to one.

**Response 200:**
```json
{
  "consus": {
    "planning": [{ "epic": null, "file_path": ".pHive/planning/prd.md", "content_hash": "...", "last_scanned_at": "..." }]
  }
}
```

### `GET /api/docs/content?repo=<name>&path=<file_path>`
Returns a specific doc's rendered content. Also upserts a target item (`itemId`, e.g.
`doc:consus:docs/api-reference.md`) so the doc always has something to target a
`POST /api/proposals` change proposal against (s5's "propose a change" mode, wired through s3)
— Consus never writes to the doc's source directly.

**Response 200:** `{ "repo": string, "path": string, "format": "md"|"html", "content": string, "itemId": string }`

## Knowledgebase

### `GET /api/kb-entries?project=<name>&q=<search>&collection=<name>`
Lists KB entries. All params optional and combinable: omit `project` for every project
(global view); omit `q` for no text filter (searches title + every version's content); omit
`collection` for every collection. `collection` must be one of `marketing`,
`boundary-decisions`, `plans`, `artifacts`, `general` (`general` is the default for entries
created without one) — an unrecognized value returns `400`, not `500` or an empty/wrong result.

**Response 200:** array of `{ id, title, current_version_id, created_at, source_repo, collection }`

### `PUT /api/kb-entries/:id`
Creates or edits a KB entry directly (outside the comment/decide flow) — every call appends a
new version (REQ-08/REQ-09), never overwrites history.

**Request body:** `{ "author": string, "content": string }`

**Response 200:** `{ "ok": true }`

### `GET /api/kb-entries/:id/versions`
Full version history for one entry, oldest first.

**Response 200:** array of `{ id, kb_entry_id, content, author, created_at }`

## Proposals (propose a change, fire it to a harness — s3)

Consus never writes `.pHive`/repo content directly. Editing a diagram or a doc means composing
a diff + description and firing it to an agent/harness via the Minerva adapter; the harness
makes the real change and reports back. One route family shared by decisions, diagrams, and
docs — `targetType` is a label, never branched on server-side.

### `POST /api/proposals`
Fires a new change proposal.

**Request body:** `{ "itemId": string, "targetType": string, "diff": string, "description": string, "requestedBy": string }`

**Response 201:** the created proposal row, `status: "pending"` — or already `"failed"` with a
`failure_reason` if dispatch to the harness itself failed (e.g. Minerva unreachable).
**404** if `itemId` doesn't reference an existing item.

### `POST /api/proposals/:id/result`
Called by the harness once it's actually applied (or failed to apply) the proposed change.

**Request body:** `{ "status": "applied"|"failed", "appliedDiff"?: string, "reason"?: string }`

On `"applied"`, writes an `audit_log` entry (`field: "proposal:<targetType>"`, `new_value` the
applied diff). On `"failed"`, no audit_log entry.

**Response 200:** the updated proposal row. **404** for an unknown proposal id.

### `GET /api/proposals?itemId=<id>`
Lists every proposal for an item, most recent first — pending, applied, and failed all included
(this is what the audit-trail panel, s5, will surface).

**Response 200:** array of proposal rows. **400** if `itemId` is omitted.

**Minerva transport config:** `MINERVA_CLI_COMMAND` (default `minerva`), `MINERVA_CLI_ARGS`
(comma-separated). No transport configured/reachable is not a startup error — a fired proposal
just resolves to `"failed"` immediately with a clear reason.

## Diagrams (epic/story cascade — s4)

### `GET /api/diagrams?repo=<name>`
The cascade org-tree for a repo: every epic under its `.pHive/epics/`, each with its stories'
id/title/complexity and dependency edges (`dependsOn`). Read-only. Reads planning YAML directly
off disk (no Multica cross-project hierarchy — that's a much larger scope than a single repo's
own epics, deliberately out of scope here). A repo with no `.pHive/epics/` yet returns
`{ epics: [] }`, not an error. **404** for an unconfigured repo, **400** without `?repo=`.

Every fetch upserts a target item (`itemId`, e.g. `diagram:consus`) so the diagram always has
something to target a `POST /api/proposals` change proposal against (s4's "propose a change"
action, wired through s3). One item per repo's diagram, not per epic/story node.

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

## Audit Trail (s5 — the shared history panel's data source)

### `GET /api/items/:id/audit-trail`
Every history entry for an item — plain `audit_log` writes (accept/mix/reject verdicts, KB
decides) merged with `proposals` (s3, any status: pending/applied/failed) — most recent first.
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

## Artifact Links

### `POST /api/items/:id/artifact-links`
Associates a claude.ai Artifact URL with an item — link only, Consus never re-renders the
Artifact's content (REQ-05).

**Request body:** `{ "url": string, "label"?: string }`

**Response 201:** `{ "ok": true }`

### `GET /api/items/:id/artifact-links`
Lists an item's linked Artifacts.

**Response 200:** array of `{ id, url, label }`

## Known gaps (not yet exposed via HTTP)

- Answering a Minerva human_request/survey question (`answerHumanRequest`,
  `server/adapters/minerva/index.ts`) and survey progress (`getSurveyProgress`,
  `server/adapters/minerva/survey.ts`) are currently internal-only — no `POST`/`GET` route
  wraps them yet. A harness can *read* open survey/human-request decisions via
  `GET /api/decisions` (they carry a `decision_payload` like any other item) but cannot yet
  submit an answer through the documented API — only through `POST /api/items/:id/decide`,
  which updates the generic item status, not the Minerva-specific answer-and-sync-back flow.
  Flagged here rather than silently omitted; closing this gap is natural follow-up work.
- Comments (`server/adapters/multica/write-comment.ts`) have no HTTP route at all yet — only
  called directly from server-side code in v1.
