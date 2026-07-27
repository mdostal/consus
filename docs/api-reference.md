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
On every call, first syncs the live Multica feed (batch-fetches ~200 issues via the configured
`MulticaClient`, ingests + classifies each one — `server/adapters/multica/ingest.ts` /
`server/decision-contract/classifier.ts`), then lists every open, undecided decision: either a
locally-authored item carrying a `decision_payload` (`dostal:decision-request/v1` shape — see
`server/decision-contract/parser.ts`), or a classified Multica issue (`id` prefixed
`multica:...`). Excludes already-decided items (the decided-store amnesia fix — REQ-08) so a
harness never re-surfaces something already resolved.

`?all=1` drops the decided-item exclusion, returning both open and decided decisions (audit/
history views).

**Response 200:** array of
```json
{
  "id": "human_request:q-1",
  "type": "human_request",
  "title": "Ship v1 with the flex-scope KB backlog cut?",
  "status": "open",
  "decision_payload": {
    "version": "dostal:decision-request/v1",
    "title": "...", "context": "...",
    "options": [{ "id": "A", "title": "...", "tradeoffs": "..." }],
    "recommended": "A"
  },
  "decision_type": null,
  "triage_bucket": null
}
```
A Multica-sourced issue has no `decision_payload` (`null`) but carries the classifier's
`decision_type` / `triage_bucket` instead:
```json
{
  "id": "multica:9f2c...",
  "type": "multica_issue",
  "title": "Choose the layout",
  "status": "in_review",
  "decision_payload": null,
  "decision_type": "choose",
  "triage_bucket": "open_question"
}
```

**Response 503:** `{ "error": "Multica fetch failed: <reason>" }` — the live Multica fetch
failed (timeout, HTTP error, or no `MulticaClient` configured via `MULTICA_SERVER_URL` /
`MULTICA_WORKSPACE_ID`). Signals a transient downstream dependency issue; clients can retry.

### `POST /api/items/:id/decide`
Submits a verdict on any item (not just human_requests — any item with a `decision_payload`,
or without one). Writes an append-only `audit_log` entry and marks the item decided (REQ-08).

**Request body:** `{ "actor": string, "newStatus": string }`

**Response 200:** `{ "item": <full item row>, "auditLog": [<audit_log rows for this item>] }`

**Response 404:** `{ "error": "item not found: <id>" }`

> Note: the client-side verdict model (Accept/Option Chosen/Mix/Reject-iterate — see
> `web/src/features/decisions/answer-shapes/types.ts`) resolves to a single `newStatus` string
> before calling this endpoint; the server itself is verdict-shape-agnostic.

## Questions (parked workflow blockers)

### `POST /api/questions`
Parks a blocking agent question. Creates a local `parked_questions` row, creates a Multica
issue labeled `hive:question`, stores the returned Multica issue ID, and returns both IDs.

**Request body:**
```json
{
  "agent_id": "agent-uuid",
  "agent_name": "Minerva",
  "question": "Which repo should receive this implementation?",
  "context": "optional background",
  "parked_workflow_id": "optional workflow id",
  "callback_url": "optional best-effort resume callback"
}
```

**Response 201:** `{ "question_id": "question-...", "multica_issue_id": "..." }`

**Response 400:** `{ "error": "agent_id, agent_name, and question are required" }`

**Response 503:** `{ "error": "Multica issue create failed: <reason>" }`

### `GET /api/questions`
Lists only unresolved parked questions (`resolved = 0`), oldest first.

**Response 200:** array of `parked_questions` rows.

### `POST /api/questions/:id/answer`
Submits the human answer for an unresolved parked question. Writes the answer as a Multica
comment, caches that comment locally, marks the question resolved, and returns the Multica
comment ID. If `callback_url` was supplied when the question was parked, Consus also attempts
a best-effort POST after the durable local/Multica updates complete.

**Request body:** `{ "answer": string, "actor"?: string }`

**Response 200:** `{ "ok": true, "comment_id": "..." }`

**Response 400:** `{ "error": "answer is required" }`

**Response 404:** `{ "error": "question not found" }` — returned when the question ID is missing
or the question is already resolved.

**Response 503:** `{ "error": "Multica comment write failed: <reason>" }`

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

### `GET /api/kb-entries?project=<name>&q=<search>`
Lists KB entries. Both params optional and combinable: omit `project` for every project
(global view); omit `q` for no text filter (searches title + every version's content).
Each entry includes `collection`, one of `marketing`, `boundary-decisions`, `plans`,
`artifacts`, or `general`.

**Response 200:** array of `{ id, title, current_version_id, created_at, source_repo, collection }`

### `PUT /api/kb-entries/:id`
Creates or edits a KB entry directly (outside the comment/decide flow) — every call appends a
new version (REQ-08/REQ-09), never overwrites history.

**Request body:** `{ "author": string, "content": string, "collection"?: "marketing"|"boundary-decisions"|"plans"|"artifacts"|"general" }`

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
