---
name: consus
description: Read Consus's open-decision queue and submit verdicts — for any Claude-Code-compatible agent harness, standalone or Pantheon-plugin mode.
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

Returns every open, undecided item carrying a `decision_payload` (the `dostal:decision-request/v1`
shape: `title`, `context`, `options[]` lettered A-Z with `tradeoffs`, a required `recommended`
letter). Already-decided items never reappear here (the decided-store amnesia fix) — no need to
track what you've already seen.

## Submitting a verdict

```
POST /api/items/:id/decide
Body: { "actor": "<your agent/harness identity>", "newStatus": "<verdict-derived status>" }
```

Consus's own web UI resolves one of four verdicts (Accept the recommended option / Option
Chosen / Mix several options with a rationale / Reject and request iteration) into a single
`newStatus` string before calling this endpoint — pick whichever status string makes sense for
your harness's own workflow; Consus's server is verdict-shape-agnostic and just records
`actor`/`newStatus` to the append-only audit log.

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
comment threads (`GET`/`POST /api/items/:id/comments`), proposing a change to a doc or diagram
(`POST /api/proposals`), and the multi-repo event review queue (`GET /api/events`). See
`docs/api-reference.md` for the full, current contract if your harness needs any of those.

## Standalone vs. Pantheon-plugin mode

Both routes above work identically in either mode — nothing in this skill is Pantheon-only.
