# Delphi/Consus Lineage — Full Inventory (2026-07-25)

Scraped after v1 shipped, before phasing the next round of work. This doc is
the single source the roadmap (`roadmap.md`) and PRD backlog (REQ-16+) draw from.

> **Correction (Mathew, same day):** `mdostal/approval` and `mdostal/pantheon`
> are **not** integration targets — both will be **redone**. "They were good
> lessons, but not the final." "Pantheon" (the dashboard shell) was itself a
> repurposed third-party tool — **Claud-ometer is a metrics 3rd-party system
> pulled in, not an owned product** — and is being rebuilt properly. **The
> only "final" Pantheon components are Consus, Heimdall, Minerva, and
> Auriga.** Read every finding below about `approval`'s engine design and the
> Claud-ometer-hosted `/delphi` route as **design lessons to inform Consus's
> own schema**, not as systems to wire real integration against right now.
> Consus's Vesta/votem adapters correctly stayed schema-pending/swappable in
> v1 — that call stands. What DOES matter going forward: Minerva and Auriga
> are real and final, so REQ-01/REQ-02 (Minerva) and REQ-06 (Auriga) are the
> integration points worth hardening, plus a stable agent-harness/API surface
> ready for when the rebuilt Pantheon comes online.

## Timeline

| Date | Repo | What it is |
|---|---|---|
| 2026-07-08 | `mdostal/approval` | Approval Actions — the real policy/quorum **engine** |
| 2026-07-08 | `mdostal/pantheon` (fork of Claud-ometer) | Dashboard shell; does not itself contain the `/delphi` route |
| ~2026-07-08–10 | Claud-ometer, hive host only (`ssh <internal-dev-host>`) | The original `/delphi` surface — richest classifier + persistence logic |
| 2026-07-11 | `mdostal/delphi` | Standalone rebuild — cleaner `decision-request/v1`, Express+React, real feature set |
| 2026-07-21 | `mdostal/human-review` | Empty scaffold — signals a **split** direction: UI-only plugin consuming `approval` as the engine |
| 2026-07-25 | `mdostal/consus` (this repo) | v1 shipped; this inventory folds the above back in |

**Reading the arc:** engine and UI were built together and coupled (Claud-ometer) → rebuilt standalone but still monolithic (`mdostal/delphi`) → the next architectural instinct was to split UI from engine (`human-review` + `approval`, unbuilt) → Consus already made that split (Vesta/votem adapters separate from the surface) without knowing this precedent existed. **The split was the right call — validated after the fact.**

## Source 1: Claud-ometer (`/delphi`, hive host, SSH-fetched)

Full-featured, single-file-heavy (`page.tsx` 2577 lines). Two things fetched in full this pass that weren't before:

### `decided-store.ts` — real "decided-store amnesia fix"
Keyed by `container:identifier` (curated DECIDE-lines) or the linked issue uuid
(regular items). A fixed `DECIDED_ACTIONS` set distinguishes **deciding**
actions (`approve`, `decide-approve`, `select-option`, `compose-hybrid`, ...)
from **deferring** ones (quorum-pending, defer) — only deciding actions clear
an item. Reconciles from an append-only audit log (`~/.multica/delphi-audit.jsonl`)
on every load so a decision already made (even before the store existed)
clears immediately. Matches by **both** stable key and linked uuid.

**Consus gap:** `kb-store-schema-and-decide-api`'s `decided_at` column is a single
boolean-ish flag — it doesn't distinguish decide-vs-defer actions, and there's
no reconciliation-from-audit-log step (though Consus's audit_log IS the SQL
table already, so reconciliation is a query, not a file-seed).

### `chat-store.ts` — per-item discussion + write-back summarization
One JSON file per ticket; `summarizeChat()` produces a comment-ready digest
("💬 [Delphi] Chat context... (N messages): ...") capped at 900 chars, posted
back into the decision write-back comment.

**Consus gap:** `comment-thread-ui` stores comments but nothing summarizes them
into the decide-action's write-back.

### `review-queue.ts` classifiers — real heuristic regexes (not fetched in full — 1316 lines; classifier functions extracted via targeted grep)

```
classifyDecisionType (first-match-wins):
  cba:     /\bcba\b|cost[\s-]?benefit|trade[\s-]?off|recommendation:|options considered/
  quorum:  /\bquorum\b|tie[\s-]?break|tiebreak|\bsplit \d|votes? (for|against)|agents? (are )?split/
  choose:  /\bchoose\b|1 of \d|pick (a|an|one|the)|which (option|approach|layout)|\boption \d|\bmockups?\b/
  survey:  /\bsurvey\b|multi[\s-]?select|select (features|all that|the features)|checklist|pick (any|many)/
  edit:    /\breport\b|amend|proofread|edit\b|\bdiff\b|redline|weekly (ops|swarm|report)|review (&|and) (amend|edit)/
  default: fallback

classifyBucket (in order):
  curated DECIDE-line              -> open_question
  hardcoded KNOWN_HUMAN_IDENTIFIERS -> open_question  (REDO-flagged — do not port the hardcoding)
  title matches DECISION_TITLE_RE  -> open_question
  NOISE_RE                         -> noise
  RESEARCH_RE                      -> research_plan
  AGENT_RE                         -> agent_task
  default                          -> agent_task   (NOT research_plan!)
```

**Consus gap:** `decision-taxonomy-and-triage`'s `classifyDecisionType` only
classifies items that already carry a structured `decision_payload` — there is
**no prose/keyword heuristic path** for legacy/unstructured items at all right
now (everything without a payload falls to `"default"`/`"research_plan"`).
The real system's heuristic regexes above are the reference implementation
for that missing path — and Consus's current default-bucket choice
(`research_plan`) is wrong relative to the real system's default (`agent_task`).

## Source 2: `mdostal/delphi` (GitHub, standalone rebuild)

Already reconciled into v1 for the `decision-request/v1` contract shape
itself (parser.ts, classifier.ts, AnswerControl.tsx, etc. — see the
`fix: correct decision-request/v1...` commit). Two more real files fetched
this pass that inform backlog items:

### `server/parse.mjs` — the real 3-tier parser (structured → heuristic → none)
Consus's `parseDecisionPayload` only implements tier 1 (structured
` ```decision-request ` block) and returns `null` on anything else. The real
implementation falls back to regex-extracted options from free-form markdown
before giving up:
- `#### Option A — title` / `Option A: title` headings
- `A) TITLE: detail` lines
- `**A — title**` (comparison-table cells)
- "recommended" resolved from the first line matching `/recommend/i` that
  names a known option letter

**Consus gap:** no heuristic fallback tier exists — a real ticket written in
prose (not the exact fenced block) currently produces no `decision_payload`
at all, when the real system would still extract options.

### `server/gitdocs.mjs` — the real multi-repo live-git resolution (REQ-20)
`extractDocCandidates()` (regex-pulls doc paths like `docs/foo.md` out of
ticket text, filtering noise like `README.md`/`CLAUDE.md`) →
`resolveInRepos()` (scans every repo under a `CODE_ROOT`, e.g.
`~/Documents/work/dostal/code/`, for a matching path) → `readGitDoc()`
(`git show ref:path` for a specific ref, else the working-tree file) +
`currentBranch()`. This is a complete, working reference implementation for
REQ-20 — Consus's Doc Scanner currently only walks one repo's
`.pHive/planning/` + `.pHive/epics/*/docs/`.

### `server/multica.mjs` — real Multica auth pattern
Token resolution: `MULTICA_TOKEN` env → `~/.config/dostal/mtok` →
`~/.multica/config.json` `.token`; bearer auth + `X-Workspace-ID` header;
20s timeout. Consus's `HttpMulticaClient` doesn't do any of this yet — it's a
bare fetch with no auth, no workspace header. **This is likely a real gap for
REQ-07, not just backlog** — worth an early follow-up.

## Source 3: `mdostal/approval` + `plugin-hive/hive/lib/approval/` (design lessons — NOT an integration target)

> **`approval` will be redone** (see correction at top) — everything below is
> read as a **reference design** for Consus's own schema, not a dependency to
> wire up. Consus's Vesta/votem adapters correctly stay schema-pending and
> swappable, exactly as v1 already built them.

`mdostal/approval`'s README pointed at a real, tested engine already sitting
at `plugin-hive/hive/lib/approval/` (ADR `hive/decisions/002-approval-engine.md`,
status: accepted) — worth reading for its *shape*, not for hooking up to it:

```
ApprovalEngine.request(actionType, actionContext, requestedBy)
  -> { pending, modeConfig } | { error: Decision }
ApprovalEngine.submit(approvalId, verdicts, timestamp)
  -> { auditRecord } | { error: Decision }
ApprovalEngine.getPending / listPending / getAuditRecord / listAuditRecords
```

Three modes, config-registry-driven per action type:
- `human-gate` — single approve/reject + identity
- `agent-quorum` — N agents, ratio pass-check (e.g. quorumSize:3, passThreshold:0.6)
- `multi-agent-vote` — named lens panel, hard-veto-capable, exact-panel-completeness enforced

`Decision = {allowed, reason, message}` (mirrors Multica's permission-layer
field names). SQLite-backed (`better-sqlite3`, WAL mode — **the same
dependency Consus already uses**), atomic resolution (race-safe between
concurrent consumers), fail-closed verdict validation (missing/duplicate
votes deny, never silently pass).

**Lessons worth carrying into Consus's own schema** (not into a dependency):
the three-mode split (human-gate/agent-quorum/multi-agent-vote) as a mental
model for what Vesta's policy *could* eventually resolve to; the
`{allowed, reason, message}` Decision shape as a clean convention; fail-closed
verdict completeness (never let a missing vote silently pass) as a rule
Consus's own future quorum logic should follow whenever it's actually built
against the redone approval system. No code integration follows from this
source right now.

## Source 4: `mdostal/human-review` (empty scaffold — architectural signal only)

```
Pantheon plugin: Level 2 (UI-ONLY) review dashboard for the approval
plugin's decision queue. Consumes the approval engine's capture records
(requires_plugins: ["approval"]) ... No engine of its own; this repo is the
GUI only. Catalog manifest port: :7806.
```

Never built beyond README + LICENSE + .gitignore. Its only value is
confirming the direction: split the UI (this repo's role) from the engine
(`approval`'s role) — exactly Consus's existing Vesta/votem-adapter
separation. No code to port; nothing else to do here.

## What does NOT need re-litigating

- `docs/prior-art.md`'s LIFT/REDO calls (real DB, harness-agnostic adapter,
  generic classification, Vesta/votem-as-separate-concerns) all still stand —
  this inventory adds detail, it doesn't reverse any of those calls.
- The `decision-request/v1` contract correction already merged (`cb6bade`) is
  confirmed correct against `mdostal/delphi`'s real source — no further change
  needed there, only the heuristic-fallback tier is new backlog.
