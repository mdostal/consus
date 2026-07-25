## Product Discovery Brief

### Problem Statement
Mathew cannot read the swarm's outputs — Consus and Pantheon-plugin kickoff/plan/execute cycles generate briefs, PRDs, architecture docs, plans, CBAs, and specs as `.md`/`.html` files on disk, unreadable in a terminal. Minerva generates questions/surveys tied to tickets that today have no rendered home to answer them in. The current workaround — Claude manually pulling a doc off the box and rendering it as a claude.ai Artifact — works but is entirely manual and per-artifact.

### Target Users
- **Primary persona:** Mathew, running the Pantheon day-to-day — wants to work *in* Consus at the level of architecture diagrams, specs, and decisions, not drop into a terminal or manage individual tickets.
- **Secondary persona:** Future OSS adopters running their own multi-agent harness against their own repos. Consus ships standalone + as a Pantheon plugin, per the Pantheon-wide "every god ships OSS + standalone" rule established in `heimdall`'s kickoff earlier today.
- **User evidence:** Personal, direct daily-operational pain — documented explicitly in `docs/north-star.md` as "THE ACUTE PAIN (the #1 requirement)."

### Competitive Landscape
- **Existing alternatives:** The current manual Claude-pulls-doc-renders-Artifact workaround (works, but fully manual and per-artifact); generic doc tools (Notion/Confluence/wikis — no agent-native read/write loop); ticket trackers (Linear/Jira-style — ticket-forwarders, not doc/decision-first). A prior internal CBA evaluated a hosted Vercel stack (Comments, Workflows, Open Agents, v0) as the collaborative layer, but it was never actually integrated — no comments, no agent fire-off, never surfaced to Mathew.
- **Key gaps in alternatives:** None combine agent-native comment/decision read-write (via Multica), a living-doc/diagram surface, and a decision-fire-off-becomes-KB loop in one rendered surface. The abandoned Vercel-stack attempt specifically proved that "adopt a hosted collaboration platform and get the loop for free" doesn't work without deliberate integration effort — a confirmed dead end for that approach.
- **Build rationale:** Two prior Consus CBA/prototype artifacts already did build-vs-buy analysis on the hardest primitives (diagram/DAG engine → React Flow recommended; comment+approval layer → hybrid: Multica-native comments + AI SDK approvals). These are treated as reference input, not a codebase to port. Scope is now reframed around the Pantheon plugin-contract nature and real interop with Auriga and Minerva, rather than the earlier, narrower framing.

### Value Proposition
- **Core differentiator:** "Open it. Read it. Decide it. Send it back." — a Consus item is the artifact itself (a doc, a CBA, a question, a KB entry), not a ticket forwarder; approving fires off real work through Auriga/Multica *and* becomes shared-truth KB.
- **Unfair advantage:** Native, already-callable integration with Multica (agent-native backend), Hermes (Slack sync), and the hive swarm (execution muscle) — plus Auriga going live 2026-07-26, giving Consus a real orchestrator to build fire-off contracts against from day one rather than a stub.
- **Switching motivation:** Replaces the fully-manual "Claude pulls a doc off the box and renders an Artifact" workflow with a persistent, linkable, agent-connected surface.

### Success Metrics
- **Primary metric:** Zero terminal-surfaced docs or decisions in Mathew's day-to-day Pantheon work — every generated artifact, Minerva question/survey, and KB entry is read, discussed, and decided inside Consus.
- **Secondary metrics:** If something is missing from Consus, Consus itself can fetch it (never "go somewhere else to find it"); Minerva questions tied to tickets get surfaced and answered async inside Consus rather than going unanswered or answered ad hoc.
- **Minimum success bar:** Mathew stops manually pulling docs off the box and rendering them as Artifacts by hand — that motion moves entirely inside Consus.
- Explicit non-goal folded into the metric: verifying that no ticket/doc is "missed" is **not** Consus's job — that's upstream ticket-completion verification, firing back before reaching Consus (see Hard Exclusions).

### MVP Scope
**In v1:**
- Surface Minerva's questions/surveys (tied to tickets) into Consus, answerable there, async — user value: the back-and-forth Q&A that turns an idea into approved work gets a real home instead of no home. **Single biggest v1 priority.**
- Browse/render generated docs (briefs, PRDs, architecture, plans, CBAs, specs) by repo/epic/phase — user value: replaces manually pulling docs off the box.
- Comment / chat / iterate on artifacts and KB entries — user value: the back-and-forth that sharpens scope before sign-off happens in place, not in a terminal.
- Surface the existing claude.ai Artifacts Mathew already generates, linked across into Consus rather than rebuilt — user value: the current workaround already works; don't reinvent the renderer, just give it a permanent, linked home.
- Real fire-off contracts against Auriga (live and soak-proven as of 2026-07-26) and Multica (callable today) — Consus reads Auriga's state via its tracker/observability surface (Auriga's EventContract + ConsumerContract get→dispatch→close/error/retry + LockContract CAS claim + TrackerAdapter/Multica); Consus does not itself dispatch through Auriga.
- KB store ("the Consus section") — a real database with audit log + version history + its own state (not flat-file). v1 = view + decide + store, the place CBAs/docs/decisions become shared truth. Multi-user/voting ("votem") is explicitly the v2 line, not v1.

**Deferred to v2+:**
- Multi-user / voting ("votem") on the KB store — reason for deferral: v1 KB is single-operator view + decide + store; collaborative multi-user semantics are a v2 concern.
- Editable diagram/DAG engine (React Flow-based redlining, per the earlier CBA) — reason for deferral: a real capability but not required for the core Q&A/doc-surface loop; can layer on once the base surface exists.
- Quorum/tiebreak decision type, multi-option "compose a hybrid" selection UI (from the earlier prototype) — reason for deferral: richer decision-surface UX beyond the core comment/Q&A/approve loop.

**Hard exclusions (never):**
- Verifying that no ticket/doc was "missed" before it reaches Consus — rationale: that's a separate, upstream ticket-completion-verification process's job; Consus surfaces and can fetch on demand, it does not audit completeness.
- Rebuilding the artifact renderer Claude already uses (the claude.ai Artifact rendering path) — rationale: it already works; Consus's job is to surface/link it, not replace it.
- Adopting a hosted platform's collaboration primitives (e.g. Vercel Comments) as the core agent-comment loop — rationale: already tried, never actually integrated end-to-end, confirmed dead end by the prior CBA; the real comment/decision loop is Multica-native.

### Technical Constraints
- **Platform:** Web UI (`has_ui: true`, `project_type: consumer-app`), local-first / self-hosted, ships via GitHub release as a standalone plugin (`ship_target: github-release`) — not a hosted Vercel deployment. The earlier Vercel-hosted-stack direction is dropped (evaluated, never actually integrated).
- **Performance:** No special requirements identified this session.
- **Compliance:** None identified.
- **Infrastructure:** Dual-mode distribution — standalone (works with any multi-agent-capable harness, stubs Pantheon-only integrations, communicates via docs/specs) *and* full Pantheon-plugin mode (real integration with Auriga/Multica/Minerva/Hermes/hive swarm) — the same Pantheon-wide rule established in `heimdall`'s kickoff.
- **Integrations:** Multica (agent-native backend — comment/decision read-write, callable today; also the board/task state machine that Auriga's TrackerAdapter targets), Hermes (Slack sync, callable today), hive swarm (execution muscle, callable today), Minerva (question/survey source, callable today), Auriga (orchestrator — live and soak-proven as of 2026-07-26; Consus is a *consumer* of its tracker/observability surface, not a dispatcher).
- **Contracts (concrete, not guessed):**
  - **Minerva → Consus:** JSON-over-stdio via the plugin-hive adapter ABI. `Question {id, text, channel, reason, status}`; the escalation classifier emits `{question, suggested_channel, confidence, reason}` — structured + confidence, decided externally. Consus *is* that "external" — it renders the classifier output as a decision.
  - **Auriga → Consus:** EventContract + ConsumerContract (get → dispatch → close/error/retry) + LockContract (CAS claim) + TrackerAdapter (Multica-backed). Consus reads state through this surface; it does not dispatch through Auriga.
  - **Living docs vs. Multica:** Multica's data model is the board/task state machine, not the living-docs model. Consus's living docs are a separate store that *references* Multica + `.pHive/planning/` + the idea board and renders them — an overlay, not a copy of Multica's schema.
  - **Contract consolidation in flight:** a parallel effort is inventorying and consolidating all Pantheon contract levels (transport ABI → domain contracts → god interfaces) into `docs/contracts/pantheon-contract-levels.md` in the meta repo, including a gap analysis (e.g. does Minerva's envelope match plugin-hive's ABI? does Consus's `decision-request/v1` line up with Minerva's classifier output?). Consus's architecture phase should consume that doc once it lands rather than re-deriving these contracts independently.

### Key Decisions Made
- Full scope reframed around the Pantheon plugin-contract nature and real interop with Auriga/Minerva, rather than porting the two prior CBA/prototype artifacts literally — those are reference background only.
- The abandoned Vercel-hosted stack (Comments/Workflows/Open Agents/v0) is out of scope — evaluated before but never actually integrated end-to-end; local-first/standalone wins, matching heimdall's precedent.
- v1's single biggest priority is surfacing Minerva's questions/surveys into Consus for async answering — the "big doc store" KB backlog is flex scope, acceptable to slip to v2.
- Consus does not verify ticket/doc completeness — that responsibility stays upstream, firing back before reaching Consus.
- Existing claude.ai Artifacts already work as a rendering path — v1 surfaces/links them rather than rebuilding a renderer.
- Auriga is live and soak-proven as of 2026-07-26 — Consus consumes its state via the tracker/observability surface (EventContract/ConsumerContract/LockContract/TrackerAdapter) rather than dispatching through it, in v1, not a stub.
- The KB store is a real database (audit log + versions + own state), not flat-file — v1 ships view + decide + store; multi-user/voting is explicitly deferred to v2.
- Living docs are Consus's own rendered overlay — referencing Multica + `.pHive/planning/` + the idea board — not a reuse of Multica's board/task-state data model.
- A parallel effort is consolidating all Pantheon contract levels into `docs/contracts/pantheon-contract-levels.md` (meta repo), with a gap analysis across Minerva/plugin-hive/Consus/Auriga envelopes. Consus's architecture phase consumes that doc once it lands.

### Open Questions
All four MVP-blocking open questions from the initial pass were resolved with concrete contracts before this brief closed (see Technical Constraints → Contracts, and Key Decisions above). Remaining open items are architecture-phase concerns, not discovery-phase ones:
1. Exact first-slice size for the KB "big doc store" (which entity types ship in v1 vs. wait) — an architecture/PRD-scoping question, not a product-discovery one.
2. Once `docs/contracts/pantheon-contract-levels.md` lands, whether it surfaces any gap between Consus's own prior-art `decision-request/v1` envelope and Minerva's classifier output — feeds directly into the architecture phase's data-contract design.

### Session Notes
Most of this session built on substantial pre-existing material: two prior Consus CBA/prototype artifacts (diagram-engine build-vs-buy, and a working "human decision surface" prototype with six decision types), plus `heimdall`'s same-day kickoff, which established the Pantheon-wide OSS+standalone distribution rule. The operator was decisive throughout — the main real narrowing happened on MVP scope (confirming Minerva-questions-in-Consus as the single biggest v1 priority, with the KB "big doc store" explicitly flexible into v2) and on ruling out the previously-explored Vercel-hosted stack, which was evaluated but never actually wired up end-to-end. Success metric stayed qualitative by design — the operator explicitly did not want a fixed SLA-style number, preferring "never see docs/decisions in a terminal" as the bar, with doc-completeness verification explicitly pushed upstream, out of Consus's scope. A follow-up round closed all four initial open questions with real, already-built contracts (Minerva's stdio/ABI envelope, Auriga's four-contract surface, the KB's real-DB requirement, and living-docs-as-overlay-not-Multica-copy) rather than leaving them for architecture to guess at — and flagged a parallel contract-consolidation effort landing in the meta repo that architecture should consume directly.
