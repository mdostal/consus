# Consus Roadmap — Post-v1 Phases

Source: `docs/delphi-lineage-inventory.md` (full scrape across Claud-ometer, `mdostal/delphi`,
`mdostal/approval`/`plugin-hive/hive/lib/approval`, `mdostal/human-review`) — **corrected same
day**: `approval` and `pantheon` (the dashboard shell) will both be redone and are read as
design lessons only, not integration targets. **The only final Pantheon components are Consus,
Heimdall, Minerva, and Auriga.** Phasing below is reordered around that correction, and around
the explicit ask to prep survey responses, the knowledgebase, and agent-harness/API readiness
for the Pantheon standing up shortly.

v1 (`consus-v1-core-loop`, merged in PR #1) shipped REQ-01 through REQ-15.

## Phase 2 — Survey depth, knowledgebase depth, agent-harness/API readiness (highest priority)

The explicit near-term ask: prep the areas Consus actually owns as a product, and make sure
it's pluggable (agent-harness *and* API) before the rebuilt Pantheon comes online.

- **REQ-26: Minerva Survey Responses (batched, multi-question).** v1's Minerva bridge
  (REQ-01/02) only models one question at a time (`ingestQuestion` → single `human_request`).
  Minerva can also emit a **survey** — a batch of related sub-questions that should be
  answered together and submitted as one response, not N independent yes/no items. Claud-ometer's
  `classifyDecisionType` already has a real `survey` type (multi-select/checklist, "pick any,
  many") as precedent for the *shape*; REQ-26 is about Minerva's bridge accepting and rendering
  that batch shape, not just retrofitting the heuristic classifier.
- **REQ-27: Knowledgebase Depth — Multi-Project "Different Areas."** Resolves PRD GAP-01 (never
  closed): the KB store today is a flat `kb_entries` table with no per-project structure. The
  original pitch (`docs/prior-art.md`, `docs/consus-definition.md`) is explicit: Consus "holds
  MANY projects underneath, each with its own view + a high-level cross-project view" — replacing
  "the documentation + knowledge-center for a dev team," not just a single-repo decision log.
  Scope: a `project` dimension on `items`/`kb_entries` (already have `source_repo` on `items` —
  audit whether it's actually used for per-project grouping anywhere in the UI; it isn't yet),
  a per-project view, and a global cross-project view.
- **REQ-28: Agent-Harness / API Surface — Formalized.** Architecture component #9
  ("Agent-facing Skill/API surface") was named in `architecture.md` but never built out beyond
  the HTTP routes that already exist for the web UI. Concretely: (a) a documented, stable API
  contract (what's already at `/api/*` today, written up so an external harness doesn't have to
  read source to use it), (b) a companion skill definition (Claude-Code-style) so any
  Claude-Code-compatible harness can read Consus's queue and post answers/decisions directly,
  (c) confirm the standalone-vs-Pantheon-plugin dual-mode boundary is actually clean at the API
  layer, not just in prose. This is the concrete prep for "plugging into the Pantheon as a whole"
  once the redone shell exists — Consus should already be pluggable *before* that shell asks for it.

## Phase 3 — Harden what v1 already claims to do (independent of the approval/pantheon redo)

Not new features — real gaps found in v1's own REQ-01..15 implementations, all independent of
the approval-engine correction (these are Consus's own code, not a dependency on `approval`).

- **REQ-22: Legacy Heuristic Decision-Type + Triage Classification.** v1's classifier has *no*
  fallback for items without a `decision_payload` at all. Port Claud-ometer's real regex
  classifiers (`classifyDecisionType`, `classifyBucket` — see inventory doc for the exact
  patterns) for that missing path. Also fixes a real bug: v1's default triage bucket is
  `research_plan`; the real system's default is `agent_task`.
- **REQ-23: Decision-Request Heuristic Fallback Tier.** Port `mdostal/delphi`'s 3-tier parser
  (structured → heuristic-from-markdown → none) — v1 only implements tier 1.
- **REQ-24: Real Multica Auth.** v1's `HttpMulticaClient` has no authentication — port the real
  token-resolution + bearer-auth + workspace-header pattern from `mdostal/delphi`'s
  `server/multica.mjs`. Closer to a bug fix than backlog.
- **REQ-25: Chat-Summarization-on-Decide.** Port Claud-ometer's `chat-store.ts`
  `summarizeChat()` pattern — a decision's write-back comment carries a summary of the
  discussion thread, not just the verdict.

## Phase 4 — Close the loop

- **REQ-16: Fire-Agents-to-Iterate.** From any item, dispatch an agent to redo/extend the work;
  results return as a new version, comparable in a Versions view.
- **Heimdall routing point (new, noted not scoped):** Claud-ometer's `extract.ts` used an AI
  model directly (flagged there as a banned cheap tier) to turn prose tickets into structured
  decisions. If Consus ever needs an AI-assisted extraction step (e.g. for REQ-23's heuristic
  tier, or for fire-agents-to-iterate's dispatch), it should route through **Heimdall**
  (the final, health-aware LLM router) rather than calling a model directly — Heimdall is one
  of the four final Pantheon components; Consus should integrate with it the same way it
  integrates with Minerva/Auriga once there's a concrete need, not preemptively.

## Phase 5 — Deepen the review experience

- **REQ-17: Save ≠ Submit (Draft Persistence).**
- **REQ-18: Sectional Review with Non-Destructive Diff.**

## Phase 6 — Multi-repo + embed (once the rebuilt Pantheon exists)

- **REQ-19: Pantheon Mount / Embed Handshake.** Deliberately last — the handshake protocol
  (`dostal:plugin-bridge/v1`) belongs to the *current* Pantheon shell, which is being redone.
  Revisit the actual protocol once the rebuilt shell's contract is published; don't build
  against the soon-to-be-replaced one.
- **REQ-20: Multi-Repo Live-Git Doc Resolution.** Port `mdostal/delphi`'s `gitdocs.mjs` pattern
  once Consus needs multi-repo doc resolution beyond its own `.pHive/` tree.

## Explicitly not re-opened

- Vesta/votem as *separate concerns* from the Consus surface — correctly built as
  schema-pending/swappable adapters in v1; stays that way until the redone `approval` system
  (or whatever replaces it) actually exists and publishes a contract.
- The `decision-request/v1` contract shape itself — corrected and merged against the real
  `mdostal/delphi` spec (commit `cb6bade`); nothing in this inventory reverses that.

## Suggested next step

Phase 2 (REQ-26/27/28) is the one to scope into an epic next — it's the explicit ask, doesn't
depend on anything being redone, and directly serves "ready to plug into the Pantheon when it
stands up." Phase 3's four items are cheap, independent hardening that could run in parallel.
