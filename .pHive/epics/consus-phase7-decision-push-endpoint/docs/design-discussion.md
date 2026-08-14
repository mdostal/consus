# Design Discussion: consus-phase7-decision-push-endpoint

## Goal

Consus's `items` table can currently only gain a new decision/CBA row through Consus's own
internal KB-store flow or the propose-a-change mechanism. There is no HTTP endpoint that lets an
outside agent or harness create a new decision item. `skills/consus/SKILL.md` documents reading
the queue (`GET /api/decisions`) and submitting a verdict (`POST /api/items/:id/decide`) — nothing
to push a new one in. This epic adds that missing write path: a generic route that accepts a
`dostal:decision-request/v1` payload and creates the corresponding `items` row, so it shows up in
`GET /api/decisions` like anything else.

## Approach

`server/decision-contract/parser.ts`'s `DecisionPayload` (`title`, `context`, `options[]` lettered
A-Z each with `tradeoffs`, a required `recommended` letter) is already a CBA shape — options
compared with tradeoffs and a recommendation is what a cost-benefit analysis is. No new payload
format is needed; this epic ships one new route, `POST /api/decisions`, that:

1. Validates the request body's `decision_payload` matches the contract shape: `version` is
   exactly `"dostal:decision-request/v1"`, `options` has at least 2 entries each with a non-empty
   `id`/`title`/`tradeoffs`, and `recommended` matches one of the supplied option ids.
2. Requires `id` (caller-supplied, see id-generation decision below) and `title` in the body.
   `source_repo` is optional.
3. Inserts a new `items` row (`type: 'decision'`, `status: 'open'`, the validated
   `decision_payload` as JSON) using the same insert shape `server/kb/store.ts` already uses
   elsewhere in this codebase, so it's consistent with existing conventions.
4. Returns the created item (id, title, decision_payload) on success.

No auth/token layer — server binds `127.0.0.1` only, single-operator, localhost-only threat model,
consistent with every other route in this codebase.

## Id generation and duplicate handling

**Decision: caller-supplied `id`, required. A duplicate id is rejected with `409 Conflict`, not
silently upserted.**

Rationale: the calling agent/harness is the one that knows what "the same decision, asked twice"
versus "a genuinely new decision" means for its own workflow — Consus has no way to infer that.
Requiring the caller to supply an id (e.g. `cba:<source-repo>:<slug>` or any scheme the caller
picks) makes idempotency the caller's responsibility, which is the same shape as
`POST /api/proposals/:id/result` already uses elsewhere in this API (caller-supplied ids,
Consus never generates one on the server's own initiative). A `409` on a duplicate is a clear
signal the caller can either treat as "already pushed, fine" (catch and ignore) or as a real bug
in their own id scheme — silently upserting would hide the second case.

## Risks

- **A caller pushes a malformed `decision_payload` that happens to pass loose validation** (e.g.
  a `recommended` letter that technically matches an option id but is semantically wrong). Not
  fully preventable server-side — this is the same trust boundary the existing decision-contract
  parser already accepts from any doc-embedded fenced block. Mitigation: validation catches
  structural errors (missing fields, wrong version string, `recommended` not matching any option),
  which is the same bar the rest of this codebase holds itself to.
- **`docs/api-reference.md`'s existing "Decisions" section is already stale** — it still describes
  a "syncs live issues from Multica" behavior that was removed in tonight's strip
  (`4653222`/`213c119`), and references a `POST /api/decisions/:key/iterate` endpoint that no
  longer exists. This predates this epic and is a known, separately-tracked gap (see
  `.pHive/planning/backlog.md`) — not fixed here beyond adding this epic's own new section
  accurately, since rewriting the rest of that file is out of this story's scope.

## Open Questions

1. Should the response on success include the full row (as if `GET /api/decisions` had returned
   it) or just `{ id, title }` confirmation? Current design: return the full item shape (id, type,
   title, status, decision_payload) — matches what a caller polling `GET /api/decisions` would see
   next, so there's one consistent shape to code against.
2. Should this route live in `server/routes/decisions.ts` (alongside the existing `GET`) or a new
   file? Current design: same file — it's the same resource, and `decisions.ts` today is small
   enough that splitting it would be premature.

## Scale

Small. One new route in an existing file, one `skills/consus/SKILL.md` section, one
`docs/api-reference.md` section, tests. No schema migration needed — `items.decision_payload` and
the other columns this uses already exist.
