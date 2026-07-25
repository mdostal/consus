# Architecture — Consus

Source: `.pHive/planning/prd.md`

**Grounding note:** Multica and the Hive adapter-ABI pattern were verified directly against their real repos (`~/Code/multica`, `~/Code/plugin-hive/hive/lib/task-tracking-dispatch`) during this phase. Auriga's `EventContract` / `ConsumerContract` / `LockContract` / `TrackerAdapter` names come from the operator's description — no Auriga repo/spec exists locally yet to verify against. Where this doc references Auriga's contract, treat the *shape* (read-only tracker/observability access) as fixed and the exact schema as **pending** `docs/contracts/pantheon-contract-levels.md` (see Risks).

**Reconciliation note (post-execution-kickoff):** `docs/prior-art.md` — a detailed inventory of a real, Playwright-verified prior `/consus` implementation on the hive host (`Claud-ometer` repo, not checked out locally) — surfaced after the first architecture pass and before any code was written. This revision folds in REQ-11 through REQ-15 (decision-request/v1 contract, decision-type taxonomy + triage buckets, Vesta policy, votem quorum routing, decision-card rendering baseline). Like Auriga, **Vesta and votem have no local repo/spec** — same treatment: build against the documented behavioral contract, flag schema as pending real access.

**Second reconciliation note (pre-push, 2026-07-25):** while pushing v1 live, discovered `mdostal/delphi` — a real, separate, more mature prior *standalone* build (2026-07-11–23, distinct from `Claud-ometer`) already on GitHub. Its `docs/decision-request-format.md` is the authoritative, field-precise spec for `dostal:decision-request/v1` — the shape this doc and `decision-request-v1-contract`'s original implementation had approximated incorrectly from prior-art.md's summary alone. **Corrected in place**: `server/decision-contract/parser.ts` now implements the real shape (options A-Z + tradeoffs + required `recommended`, fenced ` ```decision-request ` block, four-verdict model) — see PRD REQ-11. That repo also has real features v1 doesn't (fire-agents-to-iterate, save≠submit drafts, sectional review with non-destructive diff, a `dostal:plugin-bridge/v1` Pantheon embed handshake, multi-repo live-git doc resolution) — documented as PRD REQ-16–REQ-20, explicitly **not implemented this pass**, scoped for a follow-up `/plan`.

## Tech Stack

| Layer | Choice | Alternative considered | Why |
|---|---|---|---|
| Frontend | React + Vite SPA | Next.js | The prior CBA's Vercel-native direction (Comments, Workflows, Open Agents, v0) was evaluated but never integrated, and the operator explicitly ruled it out this session. Next.js's value-add is Vercel-native features (edge functions, ISR) that a self-hosted, local-first, single-operator v1 doesn't need. A plain SPA keeps the GitHub-release build artifact simple: static files + a small server, no hosting-platform coupling. |
| Backend | Node.js + TypeScript (Fastify) | Next.js API routes / Python | Same rationale as above — decouples from any hosting platform. TypeScript matches the existing Pantheon tooling (plugin-hive's own adapter-dispatch code is TS) and keeps the Minerva-adapter code shareable with that convention. |
| Database | SQLite (embedded) | Postgres | v1 is single-operator, local-first, zero-ops. SQLite matches the convention Hive itself already uses (`~/.claude/hive/kg.sqlite`). Postgres becomes worth the ops overhead only once REQ-09/multi-user (P2, out of v1 scope) is in play — documented here as the future migration trigger, not a v1 concern. |
| Real-time | WebSocket | Polling | Matches Multica's own pattern (its README advertises "real-time progress streaming via WebSocket") — consistent mental model across the Pantheon's surfaces the operator already uses. |
| Packaging | GitHub release (versioned tarball: built SPA + server + migrations) | npm-only, Docker-only | `ship_target.kind: github-release` per project profile. A tarball with a small install/start script keeps the standalone mode friction-free for OSS adopters without requiring Docker. |

## Components

1. **Consus Web UI** (React/Vite SPA) — queue view (REQ-02), doc browser (REQ-03), comment threads (REQ-04), Artifact links (REQ-05), KB browser (REQ-08/09).
2. **Consus Server** (Node/TS, Fastify) — HTTP API + WebSocket gateway; owns all state writes; the only component allowed to touch the KB Store directly.
3. **Minerva Adapter** — stdio JSON-RPC-shaped client, deliberately mirroring Hive's existing `@hive/task-tracking-dispatch` ABI pattern (`capabilities`/`abi_version` handshake, `invoke(method, params)`, `{ok, result}` / `{ok:false, recoverable, code}` error mapping with `NOT_FOUND` / `AUTH_FAILURE` / `RATE_LIMIT` / `UNKNOWN_METHOD` / `OPERATION_UNSUPPORTED` / `TIMEOUT` / `NO_ADAPTER`). Implements REQ-01's bridge: translates a Minerva `Question {id, text, channel, reason, status}` (and classifier output `{question, suggested_channel, confidence, reason}`) into a Consus `human_request` item, and writes status changes back.
4. **Auriga Tracker Reader** — read-only client against Auriga's tracker/observability surface (REQ-06). Built as a thin, swappable adapter specifically because the exact contract schema is unconfirmed locally (see Risks) — the component boundary (read dispatch/close/error/retry state, never call dispatch/claim/close) is fixed regardless of what the final schema turns out to be.
5. **Multica Client** — REST + WebSocket client against Multica's self-hosted API server (`multica setup self-host --server-url ...`) for comment/decision read-write (REQ-07) and as the read path backing Auriga's `TrackerAdapter` where applicable.
6. **Doc Scanner** — filesystem walker over configured repos' `.pHive/planning/`, `docs/`, and other generated `.md`/`.html` output; indexes by repo → epic → phase (REQ-03).
7. **Artifact Link Registry** — stores/serves claude.ai Artifact URLs associated with items, no re-rendering (REQ-05).
8. **KB Store** (SQLite) — items, human_requests, comments, audit_log, kb_entries + kb_versions, artifact_links, doc_index (REQ-08).
9. **Agent-facing Skill/API surface** — a companion skill definition (Claude Code-style) plus the same HTTP API the UI uses, so any multi-agent-capable harness — not just this Pantheon — can read the queue and post answers in standalone mode. Concretely serves the dual-mode (standalone + Pantheon-plugin) distribution requirement from the project profile.
10. **Decision Contract Parser/Renderer** — parses a `decision_payload` (the `decision-request/v1` JSON shape: question, choices/options, CBA table, `AnswerShape`) off any item and selects the deterministic native control to render (REQ-11). Additive: items without a `decision_payload` fall back to the generic item view.
11. **Decision-Type & Triage Classifier** — assigns each item a decision-type label (`cba`/`choose`/`survey`/`edit`/`quorum`/`doc`/`default`, first-match-wins) and a triage bucket (`open_question`/`your_action`/`agent_task`/`research_plan`/`noise`), consulting a human-authored override map before the heuristic (REQ-12). Generic and contract-first — no hardcoded per-item ID allowlists, per prior-art.md's explicit REDO instruction.
12. **Vesta Policy Adapter** — reads Vesta's approval policy (scope: global/repo/decision-type/risk) and determines auto-accept vs. human-gate per item (REQ-13). Schema unconfirmed locally (see Risks) — built adapter-first like the Auriga Tracker Reader.
13. **votem Router** — hands quorum-scoped items to votem and surfaces its resulting state; never implements voting itself (REQ-14). Schema unconfirmed locally (see Risks).

## Data Model (v1 sketch)

```
items            id, type (human_request | doc_ref | cba | decision | kb_entry), title, status,
                 source_repo, source_ref, created_at, updated_at,
                 decision_payload (JSON, nullable, decision-request/v1 shape) -- REQ-11
                 decision_type (cba|choose|survey|edit|quorum|doc|default, nullable) -- REQ-12
                 triage_bucket (open_question|your_action|agent_task|research_plan|noise, nullable) -- REQ-12
                 decided_at (nullable) -- REQ-08 decided-store amnesia fix: non-null items never resurface in the open queue

human_requests   id, item_id FK, minerva_question_id, text, channel, reason,
                 confidence, suggested_channel, status        -- REQ-01/REQ-02

comments         id, item_id FK, author, body, created_at, multica_comment_id (nullable)  -- REQ-04/REQ-07

audit_log        id, item_id FK, actor, field, old_value, new_value, timestamp  -- append-only, REQ-08

kb_entries       id, title, current_version_id, created_at
kb_versions      id, kb_entry_id FK, content, author, created_at  -- REQ-08

artifact_links   id, item_id FK, url, label                    -- REQ-05

doc_index        repo, epic, phase, file_path, content_hash, last_scanned_at  -- REQ-03

triage_overrides subject (item_id or a stable content key), bucket, author, created_at  -- REQ-12, beats the heuristic
```

## API Contracts

- **Minerva ↔ Consus:** stdio, dispatch-shaped per Hive's adapter ABI convention (see Minerva Adapter above). Consus calls `invoke("listQuestions", {...})` / `invoke("answerQuestion", {id, answer})`; Minerva pushes new `Question`s the same way Hive adapters expose `capabilities`/`abi_version`.
- **Auriga → Consus:** read-only, against the tracker/observability surface. **Schema pending** `docs/contracts/pantheon-contract-levels.md` — do not hard-code field names against unconfirmed internals; build the Auriga Tracker Reader's internal interface first, wire the real client once the doc lands.
- **Multica ↔ Consus:** REST (`https://api.<self-hosted-host>`) for reads/writes, WebSocket for live updates — matches Multica's documented self-hosting model.
- **Vesta → Consus:** policy read only. **Schema pending** — no local Vesta repo/spec. Build the Vesta Policy Adapter's internal interface against REQ-13's behavioral contract (resolve auto-accept vs. human-gate per repo/decision-type/risk) first.
- **Consus → votem:** hand-off only (route + read result), never a vote implementation. **Schema pending** — no local votem repo/spec.

## Key Decisions (with alternatives)

1. **SPA over Next.js** — avoids re-coupling to the Vercel-hosted direction the operator explicitly ruled out; ships as a plain static+server GitHub release artifact.
2. **SQLite over Postgres for v1** — matches the ecosystem's existing convention, zero ops for a single-operator tool; documented Postgres migration trigger is REQ-09/multi-user (P2, not v1).
3. **DAG/diagram engine explicitly deferred** — the prior CBA's React Flow recommendation stands as the *future* choice, but no engineering time is spent on it in v1 (Product Brief P2); the `items`/`kb_entries` schema doesn't block adding a `diagram` item type later.
4. **Minerva adapter reuses Hive's existing ABI pattern** rather than inventing a new stdio protocol — smaller surface area, and it's the concrete shape behind the "plugin-hive adapter ABI" the operator named as the shared transport.
5. **Auriga Tracker Reader built adapter-first, schema-pending** — rather than guessing at unconfirmed internals (`EventContract`/`ConsumerContract`/`LockContract`/`TrackerAdapter` have no local spec to verify against yet). Previously the single largest open architecture risk in this doc — now joined by Vesta and votem (#6, #7 below) under the same pattern.
6. **`decision_payload` is additive on `items`, not a schema fork** — REQ-11's `decision-request/v1` contract layers onto the existing `items` table (nullable JSON column) rather than requiring a parallel item model. Items without a payload keep working exactly as REQ-01..REQ-10 already specified.
7. **Vesta Policy Adapter and votem Router built adapter-first, schema-pending** — same pattern as #5, applied to REQ-13/REQ-14. Consus never owns the policy setting or the vote itself — only reads/routes.

## Risks / Open Items (carried from PRD Gap Report)

- **Auriga contract schema unconfirmed locally** — the Tracker Reader's real field-level shape must be finalized against `docs/contracts/pantheon-contract-levels.md` once it lands, per the Product Brief's Dependency Watch. Until then, its internal interface is written against REQ-06's behavioral contract (read-only, dispatch/close/error/retry state) rather than a guessed schema.
- **Vesta and votem contract schemas unconfirmed locally** — no local repo/spec for either, discovered via `docs/prior-art.md` reconciliation. Same treatment as Auriga: adapter-first against REQ-13/REQ-14's behavioral contracts, wire real schemas once reachable.
- **`decision-request/v1` real source not yet fetched** — prior-art.md calls for porting `decision-request.ts` "nearly verbatim" from the hive host (`ssh dostal@100.75.161.82` → `Claud-ometer/src/lib/consus/decision-request.ts`); this reconciliation pass did not fetch it. Recommended before `decision-request-v1-contract` implementation starts — building purely from prior-art.md's summary risks drifting from the actual proven shape.
- **KB "big doc store" first-slice size (GAP-01)** — which `items`/`kb_entries` subtypes ship in v1 vs. wait for REQ-09 needs an explicit call before implementation starts; this doc's data model supports either without a redesign.
- **Multica comment/decision field-level mapping** — REQ-04/REQ-07 assume Multica's comment model maps cleanly onto `comments.multica_comment_id`; a short spike against Multica's actual API (not just its README) should confirm the exact payload shape before REQ-07 implementation begins.

## Cross-Cutting Concerns & Linter Recommendation

- **Cross-cutting concerns:** tech stack (React/Node/TypeScript) doesn't match the mobile-app template — falls through to the graceful-fallback default (`documentation` concern only) per kickoff protocol Phase 4a. Written to `.pHive/cross-cutting-concerns.yaml` next.
- **Recommended linter/formatter for TypeScript/JavaScript:** ESLint + Prettier. Not detected (no codebase exists yet) — configure at project scaffold time.
