---
name: consus
description: Read Consus's open-decision queue and submit verdicts — for Claude Code, Codex CLI, or any compatible agent harness, standalone or Pantheon-plugin mode.
metadata:
  short-description: Consus decision queue — read and submit verdicts
---

# Consus — Agent Harness Skill

Consus is a standalone knowledgebase, graph, and doc editor for a repo's own decisions, docs, and
architecture. This skill lets an agent harness read its open-decision queue and submit verdicts
without reading Consus's source code. Full route detail:
[`docs/api-reference.md`](../../docs/api-reference.md) in the Consus repo.

## Base URL

Default `http://localhost:8722` (override via the `PORT` env var Consus's own server reads).
Assume the harness has network access to a running Consus instance; this skill does not start
one.

## Reading the queue

```
GET /api/decisions
```

Returns every open, undecided item carrying a `decision_payload`. The classic shape is
`dostal:decision-request/v1` (`title`, `context`, `options[]` lettered A-Z with `tradeoffs`, a
required `recommended` letter); seven other answer shapes exist (feature-selection, edit-proposal,
CBA, free-text, rating, ranking, concept-selection), each keyed by its `version` string and
listed under `POST /api/decisions` in `docs/api-reference.md`. Already-decided items never reappear here (the decided-store amnesia fix) — no need to
track what you've already seen.

## Submitting a verdict

```
POST /api/decisions/:id/verdict
Body: { "verdict": <Verdict>, "actor": "<your agent/harness identity>" }
```

This is the endpoint Consus's own web UI uses. `Verdict` is one of:

```
{ "kind": "accepted" }
{ "kind": "option_chosen", "optionId": "A" }
{ "kind": "mix", "optionIds": ["A", "B"], "why": "..." }
{ "kind": "rejected_iteration_requested", "commentary": "..." }   # reopens the item
{ "kind": "features_selected", "selected": ["..."] }
{ "kind": "text_response", "text": "..." }
{ "kind": "rated", "value": 4 }
{ "kind": "ranked", "order": ["..."] }
{ "kind": "concept_selected", "conceptId": "..." }
```

Pick the kind that matches the item's `decision_payload.version`. Consus records the verdict in the
append-only audit log, adds a summary comment, and returns
`{ "ok": true, "status": "done"|"in_progress", "decided_at": string|null }`.

There is also a lower-level `POST /api/items/:id/decide` (`{ "actor", "newStatus" }`) that writes a
raw status to the audit log without a verdict shape. Prefer `/verdict`: it's the only path that
reports the answer back to Pantheon in Pantheon mode (below).

**Do not** re-decide an item already returned without a `decision_payload`, or one no longer
present in `GET /api/decisions` — it's already resolved.

## Pushing a new decision or CBA

```
POST /api/decisions
Body: {
  "id": "<your own stable id — required>",
  "title": "<one-line summary>",
  "source_repo": "<optional — which repo/project this is about>",
  "decision_payload": {
    "version": "dostal:decision-request/v1",
    "title": "...", "context": "...",
    "options": [{ "id": "A", "title": "...", "tradeoffs": "..." }, { "id": "B", "title": "...", "tradeoffs": "..." }],
    "recommended": "A"
  }
}
```

Use this when your harness produces a decision or a CBA (cost-benefit analysis) somewhere else
and wants it to show up in Consus's queue — a CBA *is* a `decision_payload`: options being
compared, each with tradeoffs, plus a recommendation. `decision_payload` must already be a
complete, valid `dostal:decision-request/v1` object (at least 2 options, `recommended` matching
one of their ids) — this endpoint validates and stores what you send, it does not compose it for
you.

`id` is yours to choose and is required — Consus never generates one. Pick something stable for
your own workflow (e.g. deterministic from the source doc/decision), because **a duplicate `id`
is rejected with 409, not silently merged or overwritten**. That's deliberate: only you know
whether a repeat `id` means "the same decision, don't re-post it" or a real bug in your own id
scheme.

**Response 201:** the created item, same shape `GET /api/decisions` returns for it. **400** if
`id`/`title` is missing or `decision_payload` fails validation (the error names which part).
**409** if `id` already exists.

## Browsing generated docs (optional, read-only)

```
GET /api/docs?project=<name>       # omit project for every configured project
GET /api/docs/content?repo=<name>&path=<file_path>
```

Useful if your harness wants to show the operator *why* a decision exists (its source doc), not
just the decision itself.

## What this skill does NOT cover yet

This skill is deliberately scoped to the decision queue (read/verdict/push) — it's not a full
mirror of every route Consus exposes. Real capabilities that exist but aren't documented here yet:
comment threads (`GET`/`POST /api/items/:id/comments`), attachments
(`/api/items/:id/attachments`), proposing a change to a doc or diagram (`POST /api/proposals`),
and the multi-repo event review queue (`GET /api/events`). See
`docs/api-reference.md` for the full, current contract if your harness needs any of those.

## Standalone vs. Pantheon-plugin mode

Every route above works the same in either mode — nothing in this skill is Pantheon-only. The
difference is what happens around them when Consus runs with `CONSUS_HARNESS=pantheon` +
`PANTHEON_API_URL`:

- Pending Pantheon question tickets show up in `GET /api/decisions` as items grouped into a
  survey when Pantheon pushes them (below), or every 60 seconds by polling if
  `CONSUS_PANTHEON_POLL=1`.
- A deciding `POST /api/decisions/:id/verdict` on one of those items is forwarded to Pantheon as a
  partial answer, then as a submit once every item in the ticket is answered. Other decided items
  are posted to Pantheon's `/api/events/decisions`.

Forwarding is fire-and-forget: the verdict response is the same whether or not Pantheon is
reachable.

### Pushing question tickets in (no polling)

Any harness can push a question ticket in directly — the same shape as one entry of Pantheon's
question feed:

```
POST /api/questions/import
Body: { "ticket_id": "t-123", "identifier": "PANT-123",
        "questions": [{ "qid": "q1", "text": "Which DB?", "kind": "single-select", "options": ["Postgres", "SQLite"] }] }
```

201 `{ ticket_id, survey_id, item_ids }` on create; 200 `{ ticket_id, survey_id }` if the ticket
is already imported; 422 if no question maps (`single-select` needs ≥2 options, `multi` ≥1,
`free-text` always maps).

When the ticket is cancelled or answered somewhere else, close it so its survey doesn't stay open:

```
POST /api/questions/:ticket/close
Body: { "reason": "ticket cancelled", "actor"?: "<your identity, default pantheon>" }
```

Every undecided item is marked `closed` (audited, never deleted) and leaves the queue; a verdict
on it then returns 409. Repeating the call is a no-op (`closed_item_ids: []`); an unknown ticket
is 404.
