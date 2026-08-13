# Vertical Slice Plan — consus-phase5-live-and-interactive

Each slice leaves Consus in a genuinely working, demoable state. Slices
execute in order — each depends on the prior slice's stories.

## Slice 0 — Preserve the historical data (ops, no app code)

Copy `~/.multica/delphi-audit.jsonl` and `~/.multica/delphi-knowledgebase.jsonl`
off hive to durable storage (this Mac, at minimum). Blocking prerequisite for
Slice 2's import — nothing in this slice touches the Consus codebase.

**Working state after this slice**: the only unrecoverable data in this whole
epic is safe in two places.

## Slice 1 — Live Multica ingest

Wire `server/adapters/multica/client.ts` + `server/decision-contract/classifier.ts`
+ a new sync path in `server/routes/decisions.ts` so `GET /api/decisions`
reflects real, live Multica issues — classified into `decision_type` /
`triage_bucket`, validated against the `decision-request/v1` parser before
insert.

**Working state after this slice**: opening Consus shows real, live decisions
instead of an empty queue. This is the single biggest visible change in the
whole epic.

## Slice 2 — Historical backfill (generic importer, this repo only) + KB-01 schema

Build a generic (reusable) importer for the `.multica/delphi-*.jsonl` archive
shape, but run it against only this repo's archive this pass — no cross-repo
aggregation; other repos get their own Consus install later with their own
store. Count-parity checked against the 45/12 source counts. Then re-implement
the KB-01 collection schema (schema + API + tabs UI) against the current
`server/kb/store.ts` shape, using the old branch as reference/spec, not a
cherry-picked patch.

**Working state after this slice**: full decision/KB history is visible
alongside live data; KB entries can be grouped into collections.

## Slice 3 — Propose-and-dispatch mechanism (foundation for 4 and 5)

The shared capability both diagram and doc editing need: compose a change
proposal (diff + human-readable description) for an item, fire it through
the existing `server/adapters/minerva/` adapter to a harness/agent, and
receive the applied result back as a new version/diff. Consus never writes
to `.pHive` repo files directly — this dispatches the actual change to an
agent, the same shape as `consus-phase4-close-the-loop`'s iterate mechanism
but generalized to carry a doc/diagram proposal rather than only a
decision-iterate request. Step one of this capability, per the operator —
get the loop working, not a full editor.

**Working state after this slice**: a proposal can be composed, fired, and
its applied-or-pending state tracked, even before diagrams/docs have UI for
it (this slice can be demoed against a decision item first).

## Slice 4 — Diagram viewing + in-place change proposals

Add a diagram route (reference: hive's `routes/diagrams.ts` cascade org-tree
shape, PAN-7956) and a viewer component in the per-repo `ProjectView` tab,
plus a "propose a change" action wired to Slice 3's dispatch mechanism.

**Working state after this slice**: each repo tab has a diagram view, and a
diagram change can be proposed and fired to an agent from the UI.

## Slice 5 — Doc editing + audit trail UI

Extend `DocRenderer` with a "propose a change" mode (diff + description,
fired through Slice 3 — no direct writes), and add a per-item audit panel
surfacing the existing `audit_log` table plus fired/pending/applied change
proposals from Slice 3-5, reusing the comment-thread UI pattern.

**Working state after this slice**: the full loop from the original ask is
closed — see real data, view + propose changes to diagrams, propose doc
changes, audit, accept (already built), and — via the sibling
`consus-phase4-close-the-loop` epic executing alongside — send back to
iterate on decisions specifically.

## Explicit non-goals (future epics)

- Janus L2 plugin-mode integration (`consus-surface` / `consus-adapter.mjs`)
- Delphi UX ports: clients-tab, five-section-KB nav, drag-collapse
- Cross-repo historical backfill (each repo's Consus install handles its own)
- Consus writing directly to repo files under any circumstance
