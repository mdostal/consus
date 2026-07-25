---
name: consus
description: Read Consus's open-decision queue and submit verdicts — for any Claude-Code-compatible agent harness, standalone or Pantheon-plugin mode.
---

# Consus — Agent Harness Skill

Consus is the Pantheon's rendered doc/decision surface. This skill lets an agent harness read
its open-decision queue and submit verdicts without reading Consus's source code. Full route
detail: [`docs/api-reference.md`](../../docs/api-reference.md) in the Consus repo.

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

## Browsing generated docs (optional, read-only)

```
GET /api/docs?project=<name>       # omit project for every configured project
GET /api/docs/content?repo=<name>&path=<file_path>
```

Useful if your harness wants to show the operator *why* a decision exists (its source doc), not
just the decision itself.

## What this skill does NOT cover yet

- Answering a Minerva survey/human-request question through a dedicated endpoint — currently
  only reachable via the generic `/api/items/:id/decide` above (see `docs/api-reference.md`'s
  "Known gaps" section). Treat a survey's sub-questions as ordinary items from this skill's
  point of view.
- Posting comments — no HTTP route exists yet.

## Standalone vs. Pantheon-plugin mode

Both routes above work identically in either mode — nothing in this skill is Pantheon-only.
