# Consus Backlog

Structured inventory, refreshed 2026-08-13 alongside `vision-and-way-of-working.md`. Every entry
cites where it came from — a real commit range, an existing doc, or tonight's conversation. Status
values: `done` (shipped on `main`/`dev`, both at `213c119` as of tonight) · `planned-not-built`
(has a design/spec but no code) · `backlogged` (real, identified, not yet scoped) ·
`superseded-do-not-build` (the old approach is explicitly rejected; the underlying capability may
still be valid, noted where so).

Two source lineages get cited a lot below by shorthand:

- **archived-dev** = `archive/dev-2026-08-11-pantheon-coupled` — 114 commits, a parallel Consus
  build from a different machine, archived tonight because it re-coupled to Multica/Minerva/
  Auriga/Vesta/Votem. Real, working feature code sits there; it needs decoupling before anything
  from it lands on the current mainline.
- **archived-pantheon-coupled** = `archive/pantheon-coupled-consus` — this session's own
  consus-phase4-close-the-loop and consus-phase5-live-and-interactive epics, archived during
  tonight's strip for the same reason.

---

## Ingest & indexing

| Item | Status | Source |
|---|---|---|
| On-demand doc-scanner trigger (`POST /api/projects/:project/ingest`) | `done` | consus-phase6-standalone-onboarding, `006eaa3` |
| Per-project view combining diagrams + docs + KB | `done` | consus-phase6-standalone-onboarding, `6706b0c` + `213c119` |
| First-run onboarding screen (ingest CTA when nothing's indexed yet) | `done` | consus-phase6-standalone-onboarding, `ff886dc` |
| Multi-repo live-git doc resolution — resolve a doc path across *every* repo under a code root, not just one repo's own `.pHive/` tree (`extractDocCandidates` → `resolveInRepos` → `readGitDoc`, ref-aware via `git show ref:path`) | `done` | consus-phase13-multirepo-doc-resolution, `e7f3e8a`+`c2d21f1`, merged to `dev` via PR #95. Both security-sensitive pieces (path-traversal boundary check, `git show` command-injection safety) were independently code-reviewed, not just test-verified, before merging. |
| Scan-at-startup so `GET /api/docs` isn't empty on first boot (distinct from tonight's operator-triggered ingest — this was an *automatic* startup scan) | `superseded-do-not-build` | archived-dev, `cb08d1a` ("scan .pHive docs at startup"). Explicitly rejected direction: tonight's onboarding epic deliberately chose operator-triggered ingest over any automatic/background scan, per the operator's stated preference for a deliberate action. Noting it here so it isn't silently re-proposed later. |

## Architecture-level interact & propose changes

This is the loop's thinnest link today — read the vision doc's core-loop section. The archived
`dev` lineage built substantially further here than the current mainline has caught up to.

| Item | Status | Source |
|---|---|---|
| Read-only doc rendering (`DocRenderer`) | `done` | mainline, pre-dates tonight |
| Diff-compose propose-a-change (type a diff + description, fire through `HarnessTransport`) | `done` | mainline `server/proposals/store.ts`, pre-dates tonight |
| In-place doc editor with explicit edit/view mode toggle and an auto-computed-diff "Fire to harness" action distinct from "save" | `done` | consus-phase8-doc-editor-fire-action, `5ef09c0` + `dad4f46`, merged to `dev` via PR #90. Decoupled from archived-dev's `DocEditor.tsx` Minerva-park-and-resume plumbing (`0302558`/PAN-8237 etc.) — reuses the existing `POST /api/proposals` endpoint unchanged, no new backend surface. |
| Visual diagram engine — real Mermaid-rendered cascade (client-side graph build, dynamic import) plus click-a-node-for-detail | `done` | consus-phase9-mermaid-diagram-engine, `d97257f` + `a933414`, merged to `dev` via PR #91. Decoupled from archived-dev's server-side, Multica-fed Mermaid generator (`e84a56a`/PAN-7952, `b4e8bfb`/PAN-7958) — graph text is built client-side from the existing `GET /api/diagrams` response, no backend change. Click-to-detail is new UX (the archived version never wired node clicks to anything). |
| Per-repo architecture diagram generation endpoint (distinct from the epic/story cascade — an actual generated architecture diagram, not a dependency tree) | `done` | consus-phase17-architecture-diagram-endpoint, `6d12885`, merged to `dev` via PR #99. New `GET /api/diagrams/:repo/architecture`, fully separate from the existing cascade `GET /api/diagrams` (untouched). Generator (`server/lib/diagram-generator.ts`) ported from archived-dev `d01e078` (PAN-7955) with no material changes — pure local fs I/O. Deliberately no cache table (bounded depth-2/50-node walk is cheap at this repo's local, single-operator scale — see the epic's design-discussion.md for the tradeoff). Frontend: standalone `ArchitectureDiagramView.tsx`; `DiagramView.tsx` untouched. |
| Draft vs. Submit separation on KB entries (`PUT .../draft` persists without side effects; `POST .../submit` explicitly triggers a publish via the existing `createKbEntry()`) — roadmap.md's REQ-17 "Save ≠ Submit" | `done` | consus-phase11-draft-submit-separation, `e24188c`+`179f9f1`+`494ac73`, merged to `dev` via PR #93. Decoupled from archived-dev's `7ff0855`/`3b70c67`. Also fixed a real bug found during planning: the KB search query had no `state='published'` filter and would have leaked draft content into search once drafts existed. |
| Sectional, non-destructive diff view — roadmap.md's REQ-18 | `done` (descoped) | consus-phase12-sectional-diff-view, `69f25fc`, merged to `dev` via PR #94. Deliberately descoped from archived-dev's full vision (`c1eac94`/PAN-7820, `097f0d6`/PAN-7818 — human-vs-agent reconciliation per section) since that needs durable draft persistence patterns beyond what's built. Shipped: section-isolation only — editing/firing one heading-delimited section can never touch another section's in-progress edit. Cross-author reconciliation remains a real future item if wanted. |
| Two-pane Decisions layout (list + independent-scroll detail panel, URL-addressable via `?selected=<id>`) | `done` | consus-phase16-two-pane-decisions-layout, `6a08f19`, merged to `dev` via PR #98. Design precedent: archived-dev `8b5ce2d` (PAN-8609) — read for shape only, not ported (that tree had a router already in place and used `DecisionCard` as its only per-item renderer; current mainline's real per-item renderer is the richer `DecisionView`, so the detail pane reuses `DecisionView` unchanged instead — see the epic's design-discussion.md). Selection synced via a hand-rolled `URLSearchParams` + `history.replaceState` hook (no router dependency exists in this codebase). Attachments (`54d7c4e`/PAN-8610) explicitly excluded from this pass — remains a separate future item if wanted. |
| Editable diagrams (both the epic/story cascade and the architecture diagram) — direct node/edge editing with a real diff firing through the existing propose-a-change mechanism, plus a full visual system: a first-ever manual light/dark/system theme control, and 3 switchable visual skins (Drafting Table / Case Board / Harness), a collapsible read-only Mermaid source preview, and a universal ⌘K command palette with keyboard shortcuts | `done` | consus-phase18-diagram-editor-and-skin-system, 5 stories (`1cb5aed`+`b5efea1`+`c2f800d`+`b40ea3a`+`b454cb7`), merged to `dev` via PR #103. Library choice (React Flow / `@xyflow/react`) backed by a real CBA (`.pHive/epics/consus-phase18-diagram-editor-and-skin-system/docs/diagram-library-cba.md`) — real bundle-size/license research ruling out tldraw/GoJS/JointJS+ on cost, Excalidraw on representational mismatch. Design synthesized from 3 independent, blind design-agent mockups (same brief, orthogonal creative directions) verified live before being shown unfiltered to the operator, whose own cross-mockup synthesis became the spec. Mermaid's runtime rendering dependency was fully removed from the diagram views as a side effect, clearing the build's long-standing 500kb+ chunk-size warnings. |

## Decisions & CBAs

| Item | Status | Source |
|---|---|---|
| `decision-request/v1` structured contract (title/context/options-with-tradeoffs/recommended) — the CBA shape | `done` | mainline `server/decision-contract/parser.ts`, pre-dates tonight |
| Generic "push a decision/CBA into Consus" HTTP endpoint (`POST /api/decisions`) — caller-supplied id, 409 on duplicate, structural validation of the decision-request/v1 payload | `done` | consus-phase7-decision-push-endpoint, `6493896`, merged to `dev` via PR #89 |
| Heuristic decision-type + triage-bucket classification fallback for items without a structured `decision_payload` (prose/keyword regex classifiers: `cba`/`choose`/`survey`/`edit`/`quorum`/`default`; triage buckets `open_question`/`your_action`/`agent_task`/`research_plan`/`noise`) | `done` | Classifier itself (`classifyItem`, `server/decision-contract/classifier.ts`) already existed and was fully tested but no route ever called it — `decision_type`/`triage_bucket` were always null in every API response. consus-phase15-wire-decision-classifier, `8c6085e`, merged to `dev` via PR #97, wires it into `POST /api/decisions` (classify on create), `GET /api/decisions` (opportunistic backfill for null rows only, no re-classification of already-classified rows), and `detectDecisionNeededForRow` (classify inline, including on content-drift re-upserts). Design source remains `docs/delphi-lineage-inventory.md` (Claud-ometer's `review-queue.ts`); archived-dev `5ded132` is a second, now-superseded independent build of the same fallback logic. |
| Decision-request 3-tier parser (structured block → heuristic-extracted-from-markdown → none) — roadmap.md's REQ-23 | `done` | Correction: this line was stale — tier 2 (`parseHeuristicPayload`, `bc0e8f6`/PR #7) already existed before tonight's work started; the backlog note above claiming "mainline only implements tier 1" was wrong. The real remaining gap (both tiers returned an identical payload shape with no confidence signal) was closed by consus-phase10-decision-parser-tiers, `2139df8`, merged to `dev` via PR #92 — adds `extractionTier` and downgrades heuristic-tier items to the `agent_task` triage bucket. |
| Chat-summarization-on-decide (a decision's write-back carries a discussion summary, not just the verdict) — roadmap.md's REQ-25 | `done` | Correction: this line was also stale (same mistake as the REQ-23 line above) — `server/kb/chat-summary.ts`'s `summarizeChat()` already exists, is already wired into `decideItem()` in `server/kb/store.ts`, and `audit_log.chat_summary` is already a migrated column. Nothing to build here; verified by reading the actual code, not assumed. |
| Decided-store reconciliation-from-audit-log on load, keyed by both a stable key and a linked issue id, distinguishing deciding actions from deferring ones | `superseded-do-not-build` | `docs/delphi-lineage-inventory.md` Source 1 (`decided-store.ts`). Operator clarification (2026-08-16): "defer" is a verdict option that exists in *other* tools' engagement flows, not something Consus itself needs to model — Consus's job is just to record the full decision at the timestamp it happened, which `decided_at` + `audit_log` already do. No decide-vs-defer taxonomy or reconciliation step is needed; closing this rather than forcing a redesign around a vocabulary Consus doesn't have. Separately, the operator confirmed the related "doc correction over time" concept (a previously-live doc changing should diff + fire as a reviewable event) is already fully covered by consus-phase14's `doc_changed` event detection (`server/events/detect.ts`) — no gap there either. |
| Wire live decisions to an external ticket system (Multica or otherwise) | `superseded-do-not-build` | Was built twice — archived-pantheon-coupled (`s1-multica-live-ingest`) and archived-dev (`3e99853`/PAN-7776, `5c2ff82`/PAN-7770, `99f5d57`/PAN-7773). Explicitly rejected direction per tonight's strip: Consus does not sync live from any external system. The "generic push endpoint" item above is the correct decoupled replacement for this capability's actual value (getting decisions INTO Consus from wherever they're produced), without the live-sync coupling. |

## KB collections & knowledge surface

| Item | Status | Source |
|---|---|---|
| KB store with collections (`marketing`/`boundary-decisions`/`plans`/`artifacts`/`general`), audit log, versions | `done` | mainline `server/kb/store.ts`, consus-phase5-live-and-interactive's kb-01 port |
| KB backlog search + collection filtering UI | `done` | mainline `web/src/features/kb/BacklogBrowser.tsx` |
| A second, independently-built KB collection schema + API filter | `superseded-do-not-build` | archived-dev, `afe4c3b` (PAN-6478), `f93d4f1` (kb-02-collection-api). Same capability as mainline's kb-01 — redundant, not a gap. Noting only so it isn't mistaken for missing scope. |
| Multi-project "different areas" — a `project` dimension across items/KB, per-project + cross-project views | `done` | mainline `ProjectsSection`/`ProjectView`/`GlobalView`, roadmap.md's REQ-27 |

## Multi-repo event pipeline

| Item | Status | Source |
|---|---|---|
| Multi-repo scan (`POST /api/projects/scan-all`, alongside the existing per-project ingest) feeding a new event-detection pipeline (`doc_changed`/`decision_needed` triggers, composed prompt, manual status lifecycle with archival), plus a cross-repo docs search endpoint+UI | `done` | consus-phase14-multirepo-event-pipeline, `43d3e20`+`e732b65`+`47604ae`+`622aec0`+`cc178b1`+`6168b63`, merged to `dev` via PR #96. Fresh operator-requested scope (not from this backlog originally) — see `.pHive/epics/consus-phase14-multirepo-event-pipeline/docs/design-discussion.md` for the full design, including the events-vs-proposals data-model decision. `proposal_id` is the seam a future Pantheon ticket-adapter would consume for auto-fire in paired mode — deliberately not built here. |

## PR/branch-level surfacing (backlogged, not started)

| Item | Status | Source |
|---|---|---|
| Open and interact with a PR's own CBA, docs, and decisions from inside Consus — surfacing in-progress, cross-branch work the same way merged-to-main work is surfaced today | `backlogged`, explicitly priority-later | Tonight's conversation, operator's own words (quoted in full in `vision-and-way-of-working.md`'s closing section). Rationale given: most future work will be in-progress and spread across branches before landing on main. **Do not scope or design this until explicitly asked** — it's flagged here so it isn't lost, not because it's next. |

## Other real capabilities found, not cleanly fitting the above

| Item | Status | Source |
|---|---|---|
| Question inbox UI + fire-history view (Minerva-specific presentation, but the underlying "inbox of things needing a response, with history" pattern is generic) | `superseded-do-not-build` (as-implemented) | archived-dev, `2421740` (PAN-8228/8234). The Minerva coupling is rejected; the inbox-with-history *pattern* may be worth re-deriving generically later, but nothing here is ready to port as-is. |
| Parked-workflow schema + resume polling (pause a workflow on a human question, resume when answered) | `superseded-do-not-build` (as-implemented) | archived-dev, `a63b60a` (PAN-8230), `718ad7f` (PAN-8238), `f6864b6`. Tightly coupled to Minerva's specific park/resume protocol — not a generic capability as built. |
| OSS docs + GitHub Pages site | `done` (mainline's own version) | mainline `docs/PAN-7999-oss-launch-readme-vision`-equivalent work already shipped (README.md, VISION.md exist). archived-dev's `20b05c3` (PAN-7153) is a redundant second implementation — not a gap. **Caveat:** mainline's README/VISION currently still describe the pre-strip, Multica/Minerva-coupled architecture and need a rewrite pass — this was already identified earlier tonight and explicitly deferred by the operator in favor of shipping the onboarding epic first. Still outstanding. |
| Interaction polish / accessibility pass on transitions and interactive states | `backlogged` | archived-dev, `1358e9b` (PAN-7763) |
| Dual-mode server integration tests (standalone vs. Pantheon-plugin mode, exercised end-to-end) | `backlogged` — worth revisiting once there's an actual second mode to test against; today's mainline has only ever run standalone | archived-dev, `b67f23a` (PAN-7961) |
