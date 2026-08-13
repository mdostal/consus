# Design Discussion — consus-phase5-live-and-interactive

**Epic**: `consus-phase5-live-and-interactive`
**Created**: 2026-08-12
**Status**: Draft — presented for review

## § 0 Context

This build (`~/Documents/work/pantheon/consus`, this Mac) is the canonical
Consus going forward — the prior "full Pantheon integration" deploy stalled
mid-cutover a month ago (Claud-ometer's `/delphi` retired before the
replacement was fully live anywhere). A same-session reconciliation survey
("Consus Reunification Map") confirmed: this build is architecturally sound
(a deliberate `decision-request/v1` contract-first rewrite) but functionally
behind hive's abandoned rebuild, which had already proven live Multica
ingestion and a richer route surface before work stalled there too.

**North star** (`.pHive/project-profile.yaml`): replace manually pulling
generated docs and rendering them as one-off Artifacts with a persistent,
agent-connected surface for day-to-day work across the Pantheon — "a Consus
item is the artifact itself." The operator's own framing this session: "this
is our new UI" for pHive — not a thing to be told to go open and hand-edit.

## § 1 Goal

Make standalone Consus the place Mathew actually works, end to end, for a
single repo's `.pHive` state:

1. **See real data** — live Multica-backed decisions, not an empty queue.
2. **Browse and view diagrams** — not just docs/KB text.
3. **Make changes** — edit a doc/decision in place, not just view it.
4. **Audit** — see the change/decision history for an item.
5. **Accept** — already works (DecisionCard Accept/Mix/Reject).
6. **Send back to iterate** — dispatch an agent to redo/extend via Multica,
   see the result as a new version. (Already fully planned as
   `consus-phase4-close-the-loop` — this epic sequences around it, doesn't
   re-plan it.)

Explicitly **not** in this epic: Janus/L2 plugin-mode integration, and the
Delphi UX ports (clients-tab, five-section-KB, drag-collapse). Those wait
until standalone is solid, per the operator's own phasing.

## § 2 Proposed Approach

### 2.1 Live Multica ingest (foundational — nothing else matters without this)

Port the proven logic, not the proven code verbatim — hive's dev branch and
Claud-ometer's `review-queue.ts`/`decided-store.ts`/`verified-buckets.ts` are
both real, working references, but this build's decision model is
contract-first (`decision_payload` / `decision_type` / `triage_bucket`
against `dostal:decision-request/v1`), not Multica's raw issue shape. The
port is: extend `server/adapters/multica/client.ts` to poll/subscribe,
extend `server/decision-contract/classifier.ts` to assign type/triage from
a raw Multica issue, and add a sync path into `server/routes/decisions.ts`
that writes through the existing `items` table rather than a parallel store.

### 2.2 Historical data import

The two `.multica/delphi-*.jsonl` files on hive are the entire decision/KB
history and are **not derivable from git**. Export → verify count parity (45
+ 12) → import into this build's SQLite (`items` + `kb_entries`) → archive
originals on hive (never delete). This has to land before — or at minimum
alongside — 2.1, since live ingest without the backfill loses the visible
history.

### 2.3 KB-01 collection schema port

`~/.review-bootstrap/consus-kb01`'s schema/API/UI slice is complete and
tested but targets an older `server/kb/store.ts` shape. Re-implement against
current `store.ts` rather than cherry-picking the diff — the story should
treat the old branch as a spec/reference, not a patch to apply.

### 2.4 The shared mechanism: propose → dispatch to harness → applied diff

**Revised per operator feedback.** Neither diagram nor doc "editing" means
Consus writes to repo files directly. `.pHive` files are real, committed
repo files — Consus does not own them. Editing means: compose a change
proposal (a diff + a human-readable description — "Diagram 12 — added X,
removed Y — removed load balancers for direct traffic through...") and
**fire it to an agent/harness** to actually make the change on disk. The
harness executes, then reports back; Consus shows the applied diff and logs
a new version. This is the same shape as `consus-phase4-close-the-loop`'s
iterate mechanism (fire an agent, get a new version back), but general
enough to carry a doc/diagram change proposal, not only a decision-iterate
request — and it pairs with Minerva's existing pause/resume-hive-process
behavior for exactly this kind of human-in-the-loop moment. The dispatch
channel is the existing `server/adapters/minerva/` adapter (already built
for agent/harness requests), extended with a new request shape rather than
inventing a second dispatch path alongside Multica-comment-based iterate.

This is **step one** of that capability, per the operator: get the
propose-and-fire loop working for docs and diagrams. It is a shared
mechanism, built once, that both 2.5 (diagrams) and 2.6 (doc editing)
depend on — not two independent features.

### 2.5 Diagram viewing + in-place change proposals

Hive's `routes/diagrams.ts` (cascade org-tree, PAN-7956) is the reference
for the read side. New work: a diagram route + viewer component under
`web/src/features/projects/` (per-repo tab, alongside docs/KB), plus a
"propose a change" action on a diagram that composes a diff/description and
fires it through 2.4's dispatch mechanism.

### 2.6 Doc editing (via dispatch, not direct write)

`DocRenderer.tsx` is currently render-only. Add a "propose a change" mode:
compose the edit as a diff + description, fire it through 2.4's mechanism.
Consus never writes to the doc's file directly in this epic.

### 2.7 Audit trail UI

The `audit_log` table already exists in the schema. Surface it as a
per-item history panel (reuse the comment-thread UI pattern) — and this is
also the natural home for showing fired-and-returned change proposals from
2.4 (pending / applied / diff), since that's structurally the same
old-value/new-value shape `audit_log` already models.

## § 3 Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Data loss during historical import | **High** — lose the only copy of ~57 decision/KB records | Never delete `~/.multica/delphi-*.jsonl` on hive; export→verify→import; count-parity check before archiving |
| Classifier port drifts from `decision-request/v1` contract | **Medium** — malformed items break DecisionCard rendering | Validate every ingested item against the existing parser (`server/decision-contract/parser.ts`) before insert; reject/quarantine rather than store-and-crash |
| Doc-editing write-back conflicts with live-git multi-repo doc resolution (explicitly deferred per `architecture.md` REQ-16–20) | **Medium** — editing a doc Consus doesn't own the source of truth for | Scope v1 doc-editing to Consus-owned content (KB entries, decision context) first; file-backed doc editing is a separate, later story if needed |
| Scope creep toward phase4/plugin-mode/Delphi ports mid-epic | **Medium** — epic never closes | Explicit non-goals in §1; those are separate epics by design |

## § 4 Dependencies

- **Sibling epic**: `consus-phase4-close-the-loop` (iterate/versions) should
  execute alongside or just after this epic — same "send back" surface,
  already agent-ready, not touched by this epic's stories.
- **External**: Multica CLI (profile `dostal`) reachable; SSH access to
  `dostal@hive` for the one-time historical data pull.
- **Internal**: live ingest (2.1) and historical import (2.2) should land
  before diagram viewing / doc editing / audit UI — those are additive UI
  slices on top of real data, not blockers for each other.

## § 5 Resolved (operator answered directly)

1. **Doc/diagram editing** goes through the dispatch mechanism (§2.4) — a
   proposed diff + description fired to a harness/agent, which makes the
   real repo-file change and reports back. Consus never writes to `.pHive`
   files directly. This is step one of a general propose-and-fire
   capability, not scoped narrowly to "Consus-owned content."
2. **Diagrams need in-place editing** — not read-only. Covered by the same
   dispatch mechanism as doc editing (§2.4/§2.5).
3. **Historical importer**: build it generic/reusable, but this run only
   imports this repo's own archive (`~/.multica/delphi-*.jsonl` — Consus's
   own prior history). Other repos get their own Consus install later, each
   with its own indexed filesystem/store — no cross-repo aggregation import
   in this epic.

## § 6 Scale Assessment

**Large.** Multi-system (Multica live ingest, SQLite schema/data migration,
two new UI surfaces — diagrams and doc editing — plus an audit panel),
genuine data-migration risk, and a multi-slice delivery shape where each
slice needs to land in a working, demoable state before the next starts.
Vertical slice plan follows.
