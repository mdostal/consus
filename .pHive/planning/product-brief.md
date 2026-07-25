# Product Brief — Consus

Source: `.pHive/planning/product-discovery-brief.md`. Reconciled against `docs/prior-art.md`
(a real, Playwright-verified prior `/consus` implementation + accumulated design decisions,
discovered on the epic branch after the first pass of this brief/PRD/architecture — see
"Prior Art Reconciliation" below) before execution began.

## Problem

Mathew cannot read the swarm's outputs in a shell session. Pantheon kickoff/plan/execute cycles generate briefs, PRDs, architecture docs, plans, CBAs, and specs as `.md`/`.html` files on disk — unreadable in a terminal. Minerva generates questions/surveys tied to tickets with no rendered home to answer them in. Today's workaround — Claude manually pulling a doc off the box and rendering it as a claude.ai Artifact — works, but is entirely manual and per-artifact, and doesn't scale as the Pantheon grows.

## Target Users

- **Primary:** Mathew, running the Pantheon day-to-day. Wants to work *inside* Consus at the level of architecture diagrams, specs, and decisions — not drop into a terminal or manage individual tickets.
- **Secondary:** Future OSS adopters running their own multi-agent harness against their own repos. Consus ships standalone (works with any multi-agent-capable harness, stubbing Pantheon-only pieces) *and* as a full Pantheon plugin — the same dual-mode distribution rule every Pantheon "god" follows (established in `heimdall`'s kickoff).

## Core Features

### P0 — v1 core loop
- **Minerva questions/surveys surfaced into Consus**, answerable there, async, tied to tickets. The single biggest v1 priority — the back-and-forth Q&A that turns an idea into approved work needs a real home.
- **Minerva↔Consus bridge (human-request type)** — a new Consus item type that a Minerva `Question` (`{id, text, channel, reason, status}` / classifier output `{question, suggested_channel, confidence, reason}`) serializes into. Confirmed contract gap: today a `Question` maps to none of Consus's existing decision-item types, so Minerva escalations cannot reach Consus's queue. Without this bridge, the P0 above ("Minerva questions surfaced into Consus") has no concrete landing type to render into — this is the connective tissue that makes it real, not aspirational.
- **Browse/render generated docs** (briefs, PRDs, architecture, plans, CBAs, specs) by repo / epic / phase.
- **Comment / chat / iterate** on artifacts and KB entries in place.
- **Surface existing claude.ai Artifacts**, linked into Consus rather than rebuilt — the current renderer already works; don't reinvent it.
- **Read Auriga's state** via its tracker/observability surface (EventContract + ConsumerContract + LockContract + TrackerAdapter/Multica) — real contract, not a stub. Consus is a consumer, not a dispatcher.
- **Multica-native comment/decision read-write** — real, callable today.
- **KB store** ("the Consus section") as a real database with audit log + version history + its own state (not flat-file). v1 = view + decide + store — the place CBAs/docs/decisions become shared truth. Single-operator; no multi-user/voting yet. Decided items never resurface (the "decided-store amnesia fix," per prior-art.md).
- **Decision Contract (`decision-request/v1`) + deterministic renderer** — structured question/choices/CBA-table/`AnswerShape` payload; the real choice + a real Submit always render, never a lone "Approve." Prior-art.md calls this "the best pattern in the codebase" — promoted to P0, not stretch.
- **Decision-type taxonomy + triage buckets** — 7 renderer types (cba/choose/survey/edit/quorum/doc/default) and 5 triage buckets (open_question/your_action/agent_task/research_plan/noise, with a human override map) so the operator's queue collapses to real decisions, not a firehose.
- **Vesta policy read + auto-accept enforcement** — Consus reads Vesta's approval policy and auto-accepts until policy flags something strategic/ambiguous/irreversible. Vesta owns the setting; Consus is surface + enforcer, never the policy owner.
- **votem quorum routing** — when Vesta's policy says "quorum," Consus hands the item to votem and displays the result. This is routing/integration, not Consus implementing its own voting — distinct from the P2 item below.
- **Decision card rendering baseline** — theme-aware (light/dark), question+recommendation+answer-slot cards, status/severity pills, collapsible source docs — the concrete UX bar set by `docs/north-star.md`'s same-session rendering-requirement addition.

### P1 — v1 stretch (flex scope; may slip to v2 if it threatens P0)
- **KB backlog full browse + edit + chat** as a complete experience, not just view + decide + store.
- **Living docs** as Consus's own rendered overlay — referencing Multica + `.pHive/planning/` + the idea board — distinct from Multica's board/task-state data model.

### P2 — deferred to v2+
- Multi-user / **collaborative editing** on the KB store (distinct from votem quorum *routing*, which is P0 — this is Consus itself supporting concurrent human editors, not yet needed for a single-operator v1).
- Editable diagram/DAG engine (React Flow-based redlining, per the earlier CBA and prior-art.md's React Flow DAG viewer — both point at the same lift target for v2).
- Multi-option "compose a hybrid" selection UI (from the earlier prototype).

## Success Metrics

- **Primary (qualitative, by design):** Zero terminal-surfaced docs or decisions in Mathew's day-to-day Pantheon work — every generated artifact, Minerva question/survey, and KB entry is read, discussed, and decided inside Consus.
- **Secondary:** If something is missing from Consus, Consus itself can fetch it — never "go somewhere else to find it." Minerva questions tied to tickets get surfaced and answered async inside Consus.
- **Minimum bar:** Mathew stops manually pulling docs off the box and rendering them as Artifacts by hand.
- **Explicit non-goal:** Consus does not verify ticket/doc completeness — that stays an upstream process's job, firing back before reaching Consus.

## Scope Boundaries

**In scope:**
- Local-first, self-hosted web UI (`has_ui: true`, `project_type: consumer-app`), shipped via GitHub release as a standalone plugin.
- Dual-mode distribution: standalone (any multi-agent-capable harness) + full Pantheon-plugin mode.
- Real contracts against Minerva (stdio/plugin-hive adapter ABI), Auriga (tracker/observability surface), and Multica (comment/decision read-write) — all live and callable now.
- Contracts against Vesta (policy) and votem (quorum) — schema unconfirmed locally as of this reconciliation, same adapter-first treatment as Auriga.
- The `decision-request/v1` contract, ported from the real prior implementation (recommend fetching `decision-request.ts` from the hive host before implementation — see architecture.md Risks).

**Out of scope:**
- Verifying ticket/doc completeness before it reaches Consus — rationale: a separate upstream process's responsibility.
- Rebuilding the claude.ai Artifact renderer — rationale: it already works; Consus's job is to surface/link it.
- Adopting a hosted platform's collaboration primitives (e.g. Vercel Comments) as the core agent-comment loop — rationale: evaluated previously, never actually integrated end-to-end; confirmed dead end. The real comment/decision loop is Multica-native.
- Dispatching work through Auriga — rationale: Consus reads Auriga's state via the tracker surface; it does not initiate dispatch.
- Multi-user/voting on the KB, the diagram/DAG engine, and the quorum/hybrid-compose decision UI — rationale: deferred to v2+ (see P2).

## Dependency Watch

A parallel effort is consolidating all Pantheon contract levels (transport ABI → domain contracts → god interfaces) into `docs/contracts/pantheon-contract-levels.md` in the meta repo. It has already surfaced one concrete gap consumed directly into this brief: Minerva's `Question` type doesn't map to any existing Consus decision-item type (see the Minerva↔Consus bridge under P0). The Architecture phase should consume the full doc once it lands, and treat any further gap findings the same way — as direct requirement fold-ins, not just background reading.

## Prior Art Reconciliation

`docs/prior-art.md` and a `docs/north-star.md` addition landed on this epic's branch after the
first product-brief/PRD/architecture pass, before any code was written. They document a real,
Playwright-verified prior `/consus` implementation (`Claud-ometer`, on the hive host) plus
accumulated design decisions the operator had already made. This revision folds in what was
missing: the `decision-request/v1` contract, decision-type taxonomy + triage buckets, Vesta
policy + votem quorum routing, and a concrete decision-card rendering baseline — all promoted to
P0 per prior-art.md's own framing ("lift the *product*... rebuild the *plumbing*"). Nothing had
been built yet when this was found, so the fold-in was free — no rework, only re-planning.
Recommended follow-up before implementation: fetch the real `decision-request.ts` source from the
hive host (`ssh dostal@100.75.161.82` → `Claud-ometer/src/lib/consus/decision-request.ts`) rather
than rebuilding purely from prior-art.md's summary.
