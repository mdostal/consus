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
Returns a specific doc's rendered content.

**Response 200:** `{ "repo": string, "path": string, "format": "md"|"html", "content": string }`

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
