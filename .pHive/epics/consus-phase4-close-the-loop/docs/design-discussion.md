# Design Discussion — consus-phase4-close-the-loop (Phase 4)

## 0. Prelude

Planned per `PAN-3879`'s own explicit instructions (Multica project Consus)
after independently verifying Phase 3 (REQ-22–25, `PAN-3875`–`3878`) is
genuinely complete — real diffs read, fresh tests/build run on each of the
four `agent/consus-dev/*` branches before unblocking this planning issue.
Phase 3's work is done and pushed but **not yet merged to main**; this
epic's own stories build on top of `main` as it exists today (pre-Phase-3-
merge) per this repo's standing `git_flow.base_branch: main` convention —
whoever merges Phase 3 first should rebase this epic's branch, not the
other way around.

Source docs, re-read fresh for this pass: `.pHive/planning/roadmap.md`
("Phase 4 — Close the loop"), `.pHive/planning/prd.md` (REQ-16's existing
entry), `docs/delphi-lineage-inventory.md`. Nothing had changed or been
superseded since these were written that affects REQ-16 specifically.

## 1. What Are We Doing?

Exactly one requirement: **REQ-16, Fire-Agents-to-Iterate.** From any
decision item, dispatch an agent to redo/extend the work; the result comes
back as a NEW version on the same item, comparable in a Versions view.
Posts an iterate-request comment via Multica dispatch; logged for
traceability.

Per roadmap.md's own explicit scoping: the "Heimdall routing point" noted
alongside REQ-16 (routing any future AI-assisted extraction through
Heimdall rather than calling a model directly) is **NOT** part of this
epic — REQ-16 itself never calls a model directly; it only composes and
posts a Multica comment mentioning an agent, which is Multica's own
dispatch mechanism, not a direct model call. The Heimdall routing point
applies to a *different*, not-yet-existing need (e.g. if REQ-23's
heuristic tier ever needed AI-assisted extraction) — noted here as an
explicit non-goal, not silently dropped.

## 2. Real Reference Implementation (research, not guesswork)

`mdostal/delphi` already has a live, working implementation of exactly
this feature (`server/index.mjs`, `POST /api/decisions/:key/iterate`,
read in full for this design pass) — Consus's REQ-16 is a scoped port of
it, not a from-scratch design:

- Composes a markdown comment: a header, an `[@agentName](mention://agent/<id>)`
  mention line (present only when `agentId`+`agentName` are both provided),
  the prompt, optional `scope.section`/`scope.diagram` context, and a
  "deliver as a NEW version, don't overwrite the original" instruction
  line, plus a requester/timestamp/log-id footer.
- Posts that comment via the Multica issues-comments API — the mention
  line is what actually triggers Multica's own dispatch to that agent.
  **This is directly, freshly confirmed tonight** (2026-07-26, this same
  session, Auriga's `board-state-machine` epic): commenting on a Multica
  issue with an `@agent` mention re-dispatches to that agent immediately,
  no separate "assign" step needed for this pattern specifically (distinct
  from — and a lighter-weight mechanism than — the `--assignee-id`
  dispatch-on-create/dispatch-on-assign pattern used everywhere else
  tonight). Confirming this is the SAME mechanism, not a new one to
  validate from scratch, de-risks this epic significantly.
- Appends a JSONL log entry (log id, timestamp, actor, issue, verdict:
  `"iterate"`, the prompt, scope, agent, comment id) to a local decision
  log file for traceability — a separate `GET /api/log` endpoint reads it
  back, most-recent-first, capped by a `limit` query param.
- Does NOT set the issue's status by default (`setInProgress` is an
  explicit opt-in the caller can pass) — the ticket stays wherever it was;
  REQ-16 is a "fire and let it come back as a new version," not a status
  transition in itself.

## 3. Consus-Specific Adaptation

Consus already has real infrastructure this epic reuses rather than
rebuilding:
- `server/adapters/multica/write-comment.ts`'s `writeCommentAndCache()` —
  posts to Multica first, only caches locally on confirmed success, never
  a silent drop or false success (REQ-07's own discipline, already built
  by v1). REQ-16's iterate endpoint composes the delphi-style comment body
  and calls this existing function — no new Multica-write path needed.
- `server/routes/decisions.ts` — currently one `GET /api/decisions`
  endpoint. This epic adds the `POST /:key/iterate` route alongside it.
- `web/src/features/decisions/DecisionCard.tsx` — the existing card
  component this epic's "fire agent" trigger and "Versions" comparison
  hang off of.

**Scope-narrowing vs. delphi's full feature, deliberate:** delphi's
Fire-Agents-to-Iterate is reachable from "the whole doc, any section, or
any diagram" and its Versions tab compares against delphi's much larger
existing versioning system (live git files, every md attachment iteration,
Mathew's working draft). Consus's v1 has no equivalent multi-source
versioning system yet — REQ-17 (Save≠Submit) and REQ-18 (Sectional Review)
are Phase 5, not built yet. This epic's Versions view is therefore scoped
down to exactly what REQ-16 itself requires: comparing the ORIGINAL
decision item against NEW version(s) returned by iterate-requests — not a
general-purpose multi-source version comparison system. `scope.section`/
`scope.diagram` targeting is included (cheap, matches the real API shape
already specced in prd.md) but a full sectional-diff UI is explicitly
Phase 5's job, not rebuilt here.

## 4. Dependencies

- Phase 3 (REQ-22–25) genuinely complete — confirmed, see §0. Not a
  functional dependency (nothing in REQ-16 calls the Phase 3 code), just
  the standing operator policy that phases run in order.
- `write-comment.ts`, `client.ts` (REQ-24's real Multica auth, already
  built) — both reused as-is.
- Real agent identity to mention: this epic assumes at least one real
  Multica agent exists to dispatch to (mirrors the same "real verifier
  pool" gap board-state-machine hit tonight on Auriga/Heimdall) — this
  project's own `consus-dev` agent is the obvious candidate, already
  proven (REQ-22-25 were all done by it). Not a blocker, just noted so
  whoever picks up the frontend agent-picker story doesn't assume an
  arbitrary directory of agents exists.

## 5. Risks

- **Untrusted prompt content lands in a Multica comment mentioning a real
  agent** — REQ-16's whole point is dispatching real work from free-text
  input. Mitigation: this is exactly delphi's own already-proven pattern
  (real production use), not a new trust boundary Consus is inventing;
  the mention only fires for agents that already exist in the workspace
  (can't mention/dispatch an arbitrary external target), and Multica's own
  agent-dispatch permissions are the actual enforcement boundary, not
  something this epic needs to reimplement.
- **Comment-triggers-dispatch has an operational gotcha already
  documented tonight** (Auriga's own memory: commenting on an issue can
  re-dispatch even to an already-`done` issue's assignee) — worth the
  iterate endpoint being explicit in its own tests that it only fires
  once per real request, not accidentally on unrelated comment activity.

## 6. Scale Assessment

**Small.** One requirement, two real stories (backend endpoint + log,
frontend trigger + versions view), building on existing, well-understood
infrastructure with a real reference implementation to port from. No H/V
planning needed.
