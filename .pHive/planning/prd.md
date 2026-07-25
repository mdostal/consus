# PRD — Consus

Source: `.pHive/planning/product-brief.md` (Product Brief) ← `.pHive/planning/product-discovery-brief.md` (Discovery Brief)

## Requirements Breakdown

### REQ-01: Minerva↔Consus Question Bridge
A new Consus item type ("human request") that a Minerva `Question` serializes into, so escalations land in Consus's queue like any other decision item.
- **Source:** Product Brief P0 (Minerva↔Consus bridge) — confirmed contract gap, fold-in from the in-flight `pantheon-contract-levels.md` consolidation.
- **User value:** Without a landing type, Minerva's escalations have nowhere to go — this is the connective tissue that makes "Minerva questions surfaced into Consus" real rather than aspirational.
- **Acceptance criteria:**
  - Given a Minerva `Question {id, text, channel, reason, status}` arrives over the plugin-hive stdio ABI, when Consus ingests it, then it is stored and rendered as a Consus human-request item without loss of any field (id, text, channel, reason preserved verbatim).
  - Given a Minerva escalation-classifier output `{question, suggested_channel, confidence, reason}`, when Consus renders it, then `confidence` and `reason` are visible to the operator alongside the question text — the classifier's judgment is shown, not silently dropped.
  - Given a human-request item's `status` changes in Consus (e.g. answered), when the status write-back fires, then Minerva's `Question.status` reflects the same value — status stays in sync in both directions.
  - Given a Minerva `Question` with a `channel` Consus doesn't yet have a queue for, when it arrives, then Consus surfaces it in a default/catch-all queue rather than dropping it silently.

### REQ-02: Minerva Q&A Async Answering Surface
Operator can view and answer Minerva questions/surveys inside Consus, tied to their originating ticket.
- **Source:** Product Brief P0 — single biggest v1 priority.
- **User value:** The back-and-forth Q&A that turns an idea into approved work gets a real home instead of no home.
- **Acceptance criteria:**
  - Given one or more open Minerva questions exist (via REQ-01's bridge), when the operator opens Consus, then they see a queue of unanswered questions, each linked to its originating ticket.
  - Given the operator answers a question in Consus, when they submit, then the answer is persisted, the item's status moves to answered, and the answer is retrievable by whatever consumes it downstream (Minerva / the originating ticket).
  - Given a question has no ticket link (channel-only escalation), when rendered, then Consus still shows it in the queue without requiring a ticket to exist.

### REQ-03: Generated-Doc Browse & Render
Browse and render generated docs (briefs, PRDs, architecture, plans, CBAs, specs) by repo / epic / phase.
- **Source:** Product Brief P0.
- **User value:** Replaces manually pulling docs off the box and rendering them as Artifacts by hand.
- **Acceptance criteria:**
  - Given a repo has `.pHive/planning/*.md` or equivalent generated docs, when the operator browses Consus, then those docs are listed and readable, organized by repo, then epic, then phase.
  - Given a new doc is generated on disk after Consus last read that repo, when the operator refreshes/revisits, then the new doc appears without a manual pull step.
  - Given a doc is `.md` or `.html`, when rendered, then it displays as formatted content, not raw markup.

### REQ-04: Comment / Chat / Iterate In Place
Operator can comment, chat, and iterate on artifacts and KB entries directly inside Consus.
- **Source:** Product Brief P0.
- **User value:** The back-and-forth that sharpens scope before sign-off happens in place, not in a terminal.
- **Acceptance criteria:**
  - Given an artifact or KB entry is open, when the operator adds a comment, then the comment is persisted with author, timestamp, and target reference.
  - Given a comment is added via Multica's comment/decision model (REQ-07), when it's read back in Consus, then it renders identically regardless of whether it originated from Consus or another Multica-connected surface.
  - Given the operator iterates on an artifact (edits, replies, follow-ups), when each change is saved, then it's individually attributable and timestamped — not a silent overwrite.

### REQ-05: Existing Artifact Surfacing
Link and surface existing claude.ai Artifacts inside Consus rather than rebuilding the renderer.
- **Source:** Product Brief P0.
- **User value:** The current workaround already works — give it a permanent, linked home instead of reinventing it.
- **Acceptance criteria:**
  - Given a claude.ai Artifact URL is associated with a repo/epic/decision, when the operator views that item in Consus, then the Artifact is linked/embedded and reachable in one click.
  - Given an Artifact link is added, when Consus renders the parent item, then no separate re-rendering of the Artifact's content is attempted — Consus surfaces the link/embed, it does not reimplement the renderer.

### REQ-06: Auriga State Consumption (Read-Only)
Consus reads Auriga's state via its tracker/observability surface; it does not dispatch through Auriga.
- **Source:** Product Brief P0 / Discovery Brief Technical Constraints.
- **User value:** Real visibility into orchestrator-driven work without Consus taking on dispatch responsibility it doesn't own.
- **Acceptance criteria:**
  - Given Auriga's EventContract/ConsumerContract/LockContract/TrackerAdapter (Multica-backed) surface, when Consus queries it, then Consus displays current dispatch/close/error/retry state for tracked work without issuing any `dispatch`, `claim`, or `close` calls itself.
  - Given an event's state changes in Auriga (e.g. dispatch → close), when Consus next reads the tracker surface, then the displayed state reflects the change.
  - Given Consus has no dispatch capability by design, when an operator approves a decision in Consus that implies "go do this work," then Consus records the approval and hands off via Multica/the appropriate contract — it does not attempt to call Auriga's dispatch path directly.

### REQ-07: Multica Comment/Decision Read-Write
Consus reads and writes comments/decisions through Multica, the agent-native backend.
- **Source:** Product Brief P0.
- **User value:** Decisions and comments made in Consus are visible to and actionable by agents, not stuck in a human-only silo.
- **Acceptance criteria:**
  - Given the operator approves, comments on, or edits a decision in Consus, when the action is submitted, then it is written to Multica's comment/decision model, not a Consus-private store.
  - Given an agent (via Multica) picks up a comment/decision Consus wrote, when it acts on it, then Consus reflects the resulting state change on next read.
  - Given Multica is unreachable, when the operator attempts a write, then Consus surfaces a clear failure rather than silently dropping the action or falsely reporting success.

### REQ-08: KB Store (View + Decide + Store)
A real database (audit log + version history + own state) where approved CBAs/docs/decisions become shared-truth KB.
- **Source:** Product Brief P0.
- **User value:** Approved decisions and docs become durable, versioned shared truth — "go-build," not "done and forgotten."
- **Acceptance criteria:**
  - Given a decision is approved in Consus, when it's written to the KB store, then an audit-log entry records actor, timestamp, field, and old→new value.
  - Given a KB entry changes over time, when the operator views its history, then every prior version is retrievable, not just the current state.
  - Given the KB store, when queried, then it is backed by a real database — not flat files — consistent with the audit/version requirements above.
  - Given v1 is single-operator, when the schema is designed, then it does not block adding multi-user/voting semantics later (v2), but does not implement them now.
  - Given an item has been decided, when the operator views their open queue afterward, then that item does not resurface — the "decided-store amnesia fix" from prior-art.md §1: decided items stay decided.

### REQ-09 (P1, stretch): KB Backlog Full Browse + Edit + Chat
The complete KB backlog experience — browse, edit, and chat on any entry, not just view + decide + store.
- **Source:** Product Brief P1 — flex scope, may slip to v2 if it threatens P0.
- **User value:** Full interactivity with the knowledge base, not just a passive decision log.
- **Acceptance criteria:**
  - Given the KB store (REQ-08) exists, when the operator browses the backlog, then they can filter/search across all entries, not just recently-decided ones.
  - Given a KB entry, when the operator edits it directly (outside the comment flow), then the edit is versioned per REQ-08's audit requirements.
  - **Explicit scope note:** if implementation time threatens REQ-01 through REQ-08, this requirement is the first to slip to v2 — per the Product Brief's flex-scope call.

### REQ-10 (P1, stretch): Living Docs Overlay
Consus's own rendered overlay referencing Multica + `.pHive/planning/` + the idea board — distinct from Multica's board/task-state data model.
- **Source:** Product Brief P1.
- **User value:** A single coherent "shape of things" view instead of three separate systems the operator has to mentally merge.
- **Acceptance criteria:**
  - Given content exists in Multica, `.pHive/planning/`, and the idea board, when Consus renders a living doc, then it composes references from all three sources into one view.
  - Given the underlying sources change, when the operator revisits the living doc, then it reflects current state — it is not a one-time snapshot.
  - Given Consus's living-docs store, when inspected, then it is confirmed distinct from Multica's board/task-state schema — an overlay, not a duplicate copy.

---

## Requirements added after prior-art.md reconciliation

`docs/prior-art.md` documents a real, Playwright-verified prior `/consus` implementation
(`Claud-ometer`, on the hive host) plus accumulated design decisions the operator had
already made before this kickoff. These requirements were missing from the original
REQ-01..REQ-10 pass and are promoted to **P0** — per prior-art.md's own framing, the
reframe + `decision-request/v1` contract + triage buckets are the *product*, not stretch
scope. REQ-01 (Minerva bridge) and REQ-08 (KB store) are unchanged but now explicitly
compose with REQ-11.

### REQ-11: Decision Contract (`decision-request/v1`) + Deterministic Renderer
**CORRECTED 2026-07-25** after finding the actual `mdostal/delphi` GitHub repo (a real,
separate, more mature prior standalone build, 2026-07-11–23 — distinct from the
`Claud-ometer` prior-art) whose `docs/decision-request-format.md` is the authoritative,
field-precise definition of `dostal:decision-request/v1`. The original REQ-11 pass (below,
struck through in spirit) approximated this contract from prior-art.md's summary and got
the shape wrong; the real contract is:

```json
{
  "version": "dostal:decision-request/v1",
  "title": "...", "context": "...",
  "options": [{"id": "A", "title": "...", "tradeoffs": "..."}],
  "recommended": "A", "diagram": true,
  "doc": {"repo": "...", "path": "...", "ref": "main"}
}
```

embedded in a fenced ` ```decision-request ` block (not ` ```json `). Options are lettered
A-Z (2-26 entries); `recommended` is required — "agents must always take a position." The
verdict a reviewer renders is one of **ACCEPTED** / **OPTION X CHOSEN** / **MIX** (several
options + a required "why") / **REJECTED — ITERATION REQUESTED** (commentary, re-dispatches
to agents). This has already been implemented correctly in `server/decision-contract/parser.ts`
per the real spec, superseding the original `AnswerShape` enum design.
- **Source:** `mdostal/delphi` repo, `docs/decision-request-format.md` (the authoritative
  source — same `dostal:decision-request/v1` identifier prior-art.md referenced but didn't
  fully specify).
- **User value:** The real choice + a real verdict always appear — never a lone "Approve"
  button standing in for an actual decision.
- **Acceptance criteria:**
  - Given an item carries a `decision_payload` conforming to `dostal:decision-request/v1`,
    when Consus renders it, then every option (A-Z) is shown with its tradeoffs, the
    `recommended` option is visually marked, and the four verdict actions (Accept/Option
    Chosen/Mix/Reject-iterate) are all available.
  - Given an item has no `decision_payload`, when Consus renders it, then it falls back to
    the generic item view (REQ-03/REQ-05 doc rendering) — the contract is additive, not a
    hard requirement on every item.
  - Given a Minerva `Question` (REQ-01) is ingested, when it's stored, then its
    `human_request` record also carries a `decision_payload` translation (a minimal 2-option
    A=Yes/B=No shape, `recommended: "A"` absent a stronger signal) so it renders through this
    same deterministic path rather than a bespoke queue-item UI.
  - Given a MIX verdict, when submitted, then it requires both 2+ selected option ids AND a
    non-empty "why" — a mix without rationale is rejected client-side.
  - Given a REJECTED verdict, when submitted, then it requires non-empty commentary and maps
    to ticket status `in_progress` (all other verdicts map to `done`), per the real spec's
    verdict table.

### REQ-12: Decision-Type Taxonomy + Triage Buckets
Classify each item into one of 7 decision-type renderers (`cba` | `choose` | `survey` |
`edit` | `quorum` | `doc` | `default`, first-match-wins) and separately into a triage
bucket (`open_question` | `your_action` | `agent_task` | `research_plan` | `noise`), with
a human-authored override map that beats the heuristic classifier.
- **Source:** prior-art.md §1 "Triage buckets — the killer feature" / §3 LIFT #3.
- **User value:** "200 mis-routed items collapse to what needs YOU" — the operator's queue
  shows ~6 real decisions, not a firehose. Ops/stale garbage never reaches Needs-you and
  genuine decisions always do, once overridden.
- **Acceptance criteria:**
  - Given an item, when classified, then it receives exactly one decision-type label
    (first-match-wins across the 7 types) used to select its renderer.
  - Given an item, when triaged, then it receives exactly one bucket label; `open_question`
    items surface first in the operator's "Needs you" view.
  - Given a human-authored override entry exists for an item, when classification runs,
    then the override wins over the heuristic classifier's bucket assignment.
  - **Explicit non-goal (carried from prior-art.md's REDO list):** no hardcoded per-item
    identifier allowlists (the prior build's `KNOWN_HUMAN_IDENTIFIERS` /
    `FORCE_INCLUDE_IDENTIFIERS` firefighting patch) — classification must be generic,
    driven by the decision-request/v1 contract at the source where possible, not scraping
    plus a hand-patched ID list.

### REQ-13: Vesta Policy Read + Auto-Accept Enforcement
Consus reads an approval policy owned by Vesta (scope: global / per-repo / per-decision-
type / per-risk-level) and auto-accepts items until the policy flags one as needing a
human gate (strategic / ambiguous / irreversible).
- **Source:** prior-art.md §2 "Approval policy is CENTRAL — never per-plugin."
- **User value:** Replaces "Mathew doing yes-yes-yes manually" with policy-driven
  auto-accept — the operator only sees what actually needs a human.
- **Acceptance criteria:**
  - Given Vesta's policy for an item's repo/decision-type/risk combination is "auto,"
    when the item arrives, then Consus accepts it without surfacing a human gate.
  - Given Vesta's policy flags an item as strategic, ambiguous, or irreversible, when the
    item arrives, then Consus surfaces it in the human queue regardless of any other
    signal.
  - Given Consus is running standalone (no Pantheon, no Vesta reachable), when policy
    lookup fails, then Consus falls back to a local default policy (documented as
    "auto / bare gate" in prior-art.md) rather than blocking or crashing.
  - **Explicit non-goal:** Consus never owns the approval-policy *setting* itself — it
    reads Vesta's knob and enforces it; it does not provide its own policy-configuration
    UI beyond the standalone-mode local default.
  - **Risk (schema pending, same treatment as Auriga):** no local Vesta repo/spec exists
    as of this reconciliation — build against this behavioral contract, wire the real
    schema when Vesta is confirmed reachable.

### REQ-14: votem Quorum Routing
When Vesta's policy specifies "quorum" for a decision, Consus routes it to votem as the
resolving mechanism rather than implementing voting itself.
- **Source:** prior-art.md §2 — "votem is the MECHANISM Consus routes to when policy says
  quorum."
- **User value:** Keeps quorum voting logic in one place (votem) instead of duplicating it
  inside Consus; Consus stays a surface, not a policy engine.
- **Acceptance criteria:**
  - Given Vesta's policy resolves to "quorum" for an item, when Consus processes it, then
    it hands the item to votem and displays votem's resulting state (including any
    tiebreak already recorded) rather than running its own vote.
  - Given votem is unreachable, when a quorum-routed item is processed, then Consus
    surfaces a clear "quorum unavailable" state rather than silently falling back to a
    direct human decision that bypasses the configured policy.
  - **Risk (schema pending, same treatment as Auriga/Vesta):** no local votem repo/spec
    exists as of this reconciliation.

### REQ-15: Decision Card Rendering Baseline (theme-aware UX)
The baseline visual/UX contract every rendered artifact and decision follows.
- **Source:** `docs/north-star.md` "Rendering requirement — the artifact UI (Mathew
  2026-07-25)," added same-session as a direct requirement, drawn from three hand-built
  precedent artifacts.
- **User value:** "One readable page per artifact — the thing you review instead of
  scrolling a shell," consistently, everywhere in Consus.
- **Acceptance criteria:**
  - Given any decision item, when rendered, then it appears as a decision card: a
    question + a recommendation + an answer slot (the go/no-go pattern).
  - Given the operator's system/app theme is light or dark, when Consus renders, then all
    surfaces use theme-aware tokens — no hardcoded light-only or dark-only styling.
  - Given an item has a status or severity (P0/P1, in-flight/dropped, ready/seed, etc.),
    when rendered, then it displays as a pill, not buried in prose.
  - Given a source doc is long, when displayed alongside a decision, then it renders as a
    collapsible block, not an always-expanded wall of text.
  - Given wide content (tables, diagrams), when rendered, then it scrolls within its own
    container — the page itself never scrolls horizontally.

---

## Backlog — requirements found via `mdostal/delphi` reconciliation (NOT implemented this pass)

Discovered 2026-07-25 while pushing v1 live: `mdostal/delphi` is a real, separate, more
mature prior standalone build (2026-07-11–23) with genuine feature depth v1 doesn't have.
Per operator decision, REQ-11 above was corrected against its documented contract (done),
but the following are **documented backlog only** — not built in this pass, so the
push/PR isn't blocked on them. Each references the exact feature in that repo's README.

### REQ-16: Fire-Agents-to-Iterate
From any item, section, or diagram: ask a question or dispatch an agent to redo/extend the
work; results return as a NEW version on the same item, comparable in a Versions view.
Posts an iterate-request comment via Multica dispatch; logged for traceability.
- **Source:** `mdostal/delphi` README "Fire-agents-to-iterate (🔥)"; API shape:
  `POST /api/decisions/:key/iterate {prompt, agentId?, agentName?, scope:{section?,diagram?}}`.

### REQ-17: Save ≠ Submit (Draft Persistence)
A reviewer can SAVE an in-progress review (edits/notes/ticks/commentary) as a server-side
draft and return later — distinct from SUBMIT, which fires the write-back and consumes the
draft. Reset undoes back to the delivered original.
- **Source:** `mdostal/delphi` README "SAVE ≠ SUBMIT"; API: `GET|PUT|DELETE /api/drafts/:key`.

### REQ-18: Sectional Review with Non-Destructive Diff
Long docs split into heading-delimited sections; inline note/edit per section as a
non-destructive overlay (the underlying file is never touched); a Diff tab shows
delivered-vs-reviewer as a unified diff, which is what gets written back.
- **Source:** `mdostal/delphi` README "Sectional review."

### REQ-19: Pantheon Mount / Embed Handshake (`dostal:plugin-bridge/v1`)
Consus runs standalone-first but is host-mountable via iframe embed
(`?embed=1`, hides its own branding chrome). On load, posts
`{protocol:'dostal:plugin-bridge/v1', app, event:'ready', pendingCount}` to `window.parent`,
and `{event:'badge', pendingCount}` on queue changes; the host may post
`{event:'navigate', key}` to deep-link into a specific item.
- **Source:** `mdostal/delphi` README "Pantheon mount contract"; `web/src/bridge.js` in that
  repo. This is the concrete mechanism behind the "mounts as a tab in Pantheon" framing
  already in `docs/consus-definition.md` — previously undocumented as a wire protocol.

### REQ-20: Multi-Repo Live-Git Doc Resolution + Cross-Source Versions
Prefer the live git file on its current branch (across multiple configured repos under a
code root) over a stale attachment/description copy; compare every available version
(live git, each attachment iteration, description-embedded, working draft) side-by-side or
as a unified diff.
- **Source:** `mdostal/delphi` README "Everything in-app, zero downloads," "Versions
  side-by-side." Extends REQ-03's Doc Scanner (currently single-repo, `.pHive/planning/`
  and `.pHive/epics/*/docs/` only) to arbitrary configured repos + git refs.

These are not yet scoped into epic stories — recommended next step is a follow-up `/plan`
pass once v1 ships, scoping REQ-16..REQ-20 the same way REQ-11..REQ-15 were scoped after
the prior-art.md reconciliation.

---

## Backlog, part 2 — full lineage scrape (`docs/delphi-lineage-inventory.md`, post-v1)

After v1 shipped, a deeper scrape (Claud-ometer's real classifier/persistence source via SSH,
`mdostal/delphi`'s remaining server files, `mdostal/approval`, `mdostal/human-review`) surfaced
more backlog — **and a correction**: `approval` and the `pantheon` dashboard shell will both be
**redone**; they're design lessons, not integration targets. The only final Pantheon components
are Consus, Heimdall, Minerva, and Auriga. Full detail and phasing lives in
`.pHive/planning/roadmap.md`; requirements summarized here for traceability:

- **REQ-22:** Legacy heuristic decision-type + triage classification (v1 has no fallback path
  for items without a `decision_payload`; also fixes a real default-bucket bug).
- **REQ-23:** Decision-request heuristic fallback tier (v1 only implements the structured-block
  parse tier).
- **REQ-24:** Real Multica auth (v1's client has none).
- **REQ-25:** Chat-summarization-on-decide.
- **REQ-26:** Minerva survey responses — batched, multi-question, not just one at a time.
- **REQ-27:** Knowledgebase depth — per-project structure + cross-project view (closes GAP-01).
- **REQ-28:** Agent-harness/API surface, formalized and documented — prep for plugging into the
  Pantheon once it's redone.

REQ-16 (fire-agents-to-iterate), REQ-17 (save≠submit), REQ-18 (sectional review+diff), REQ-19
(Pantheon embed handshake), REQ-20 (multi-repo doc resolution) carry forward from the first
lineage pass — see `roadmap.md` for updated phase placement (REQ-19 in particular is now
deliberately last, since it targets a protocol owned by the shell being redone).

## Gap Report

- **GAP-01:** Exact first-slice size for the KB "big doc store" (which entity types ship in v1 vs. wait) is still open per the Discovery Brief's remaining open items.
  - Evidence: Discovery Brief Open Questions #1.
  - Recommended resolution: Architecture phase scopes this explicitly against REQ-08/REQ-09.
- **GAP-02:** Once `docs/contracts/pantheon-contract-levels.md` fully lands, further gaps beyond the Minerva `Question` bridge (REQ-01) may surface — e.g. whether Consus's own `decision-request/v1` envelope lines up cleanly with Minerva's classifier output end-to-end.
  - Evidence: Discovery Brief Open Questions #2; Product Brief Dependency Watch.
  - Recommended resolution: Architecture phase treats the consolidated doc as a live input, not just background reading — per the Product Brief's explicit instruction to fold in further gap findings as requirements, not just notes.

## Scope Boundaries

**In scope:** REQ-01 through REQ-08 (P0, v1 core); REQ-09/REQ-10 (P1, stretch — may slip to v2).

**Out of scope (v1):**
- Verifying ticket/doc completeness before it reaches Consus — Rationale: upstream process's responsibility, not Consus's.
- Rebuilding the claude.ai Artifact renderer — Rationale: already works (REQ-05 links to it instead).
- Adopting a hosted platform's collaboration primitives (e.g. Vercel Comments) as the core agent-comment loop — Rationale: evaluated previously, never integrated end-to-end, confirmed dead end.
- Dispatching work through Auriga — Rationale: Consus is a state consumer only (REQ-06).
- Multi-user/voting on the KB, the diagram/DAG engine, and the quorum/hybrid-compose decision UI — Rationale: deferred to v2+ per Product Brief P2.

## Priority Matrix

| Feature | User Value | Effort | Priority |
|---------|-----------|--------|----------|
| REQ-01 Minerva↔Consus bridge | High — unblocks REQ-02 entirely | Medium | P0 |
| REQ-02 Minerva Q&A surface | High — #1 stated priority | Medium | P0 |
| REQ-03 Doc browse/render | High — core "stop using terminal" value | Medium | P0 |
| REQ-04 Comment/chat in place | High — completes the discussion loop | Medium | P0 |
| REQ-05 Artifact surfacing | Medium — convenience, low technical risk (linking, not rebuilding) | Low | P0 |
| REQ-06 Auriga state read | High — real visibility, contract already exists | Medium | P0 |
| REQ-07 Multica read/write | High — makes decisions agent-actionable | Medium | P0 |
| REQ-08 KB store | High — "go-build" + shared truth | High | P0 |
| REQ-09 KB backlog full CRUD | Medium — enriches REQ-08 | High | P1 |
| REQ-10 Living docs overlay | Medium — unifies three sources into one view | High | P1 |

## Success Metrics

- **Primary (qualitative):** Zero terminal-surfaced docs or decisions in Mathew's day-to-day Pantheon work.
- **Secondary:** If something is missing from Consus, Consus itself can fetch it; Minerva questions get surfaced and answered async inside Consus (REQ-01/REQ-02 directly serve this).
- **Minimum bar:** Manual "Claude pulls a doc off the box and renders an Artifact" workflow stops entirely, replaced by REQ-03/REQ-05.
