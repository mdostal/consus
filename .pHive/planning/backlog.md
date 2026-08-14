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
| Multi-repo live-git doc resolution — resolve a doc path across *every* repo under a code root, not just one repo's own `.pHive/` tree (`extractDocCandidates` → `resolveInRepos` → `readGitDoc`, ref-aware via `git show ref:path`) | `backlogged` | `docs/delphi-lineage-inventory.md` Source 2 (`mdostal/delphi`'s `server/gitdocs.mjs`) — a complete reference implementation, currently un-ported. Consus's doc-scanner today only walks one repo. |
| Scan-at-startup so `GET /api/docs` isn't empty on first boot (distinct from tonight's operator-triggered ingest — this was an *automatic* startup scan) | `superseded-do-not-build` | archived-dev, `cb08d1a` ("scan .pHive docs at startup"). Explicitly rejected direction: tonight's onboarding epic deliberately chose operator-triggered ingest over any automatic/background scan, per the operator's stated preference for a deliberate action. Noting it here so it isn't silently re-proposed later. |

## Architecture-level interact & propose changes

This is the loop's thinnest link today — read the vision doc's core-loop section. The archived
`dev` lineage built substantially further here than the current mainline has caught up to.

| Item | Status | Source |
|---|---|---|
| Read-only doc rendering (`DocRenderer`) | `done` | mainline, pre-dates tonight |
| Diff-compose propose-a-change (type a diff + description, fire through `HarnessTransport`) | `done` | mainline `server/proposals/store.ts`, pre-dates tonight |
| In-place doc editor with explicit edit/view mode toggle and an auto-computed-diff "Fire to harness" action distinct from "save" | `done` | consus-phase8-doc-editor-fire-action, `5ef09c0` + `dad4f46`, merged to `dev` via PR #90. Decoupled from archived-dev's `DocEditor.tsx` Minerva-park-and-resume plumbing (`0302558`/PAN-8237 etc.) — reuses the existing `POST /api/proposals` endpoint unchanged, no new backend surface. |
| **Visual diagram engine** (Mermaid-rendered `DiagramView.tsx`, 275 lines; separately a `DiagramViewer.tsx`, 203 lines) vs. mainline's current plain nested-list `DiagramView` | `backlogged` | archived-dev, `e84a56a` (PAN-7952), `b4e8bfb` (PAN-7958). Mainline's diagram view was an explicit "deferred, not this story's scope" decision documented in its own source comment — this is the deferred capability, already built once, sitting unused. |
| Per-repo architecture diagram generation endpoint (distinct from the epic/story cascade — an actual generated architecture diagram, not a dependency tree) | `backlogged` | archived-dev, `d01e078` (PAN-7955) |
| Draft vs. Submit separation on KB entries (`PUT .../draft` persists without side effects; `POST .../submit` explicitly triggers an approve→phase-split→KB pipeline) — this is roadmap.md's REQ-17 "Save ≠ Submit" | `backlogged` | archived-dev, `7ff0855` (PAN-7816 draft storage), `3b70c67` (PAN-7819 submit endpoint + `server/kb/pipeline.ts`). Real, tested (`pipeline.test.ts` asserts Save never imports the pipeline module — isolation proven, not just claimed). |
| Sectional, non-destructive diff view for human-vs-agent edits — roadmap.md's REQ-18 | `backlogged` | archived-dev, `c1eac94` (PAN-7820), `097f0d6` (PAN-7818 editable sections UI) |
| Two-pane Decisions layout (list + independent-scroll detail panel, URL-addressable via `?selected=<id>`) | `backlogged` | archived-dev, `8b5ce2d` (PAN-8609), `54d7c4e` (PAN-8610 attachments in detail panel) |

## Decisions & CBAs

| Item | Status | Source |
|---|---|---|
| `decision-request/v1` structured contract (title/context/options-with-tradeoffs/recommended) — the CBA shape | `done` | mainline `server/decision-contract/parser.ts`, pre-dates tonight |
| Generic "push a decision/CBA into Consus" HTTP endpoint (`POST /api/decisions`) — caller-supplied id, 409 on duplicate, structural validation of the decision-request/v1 payload | `done` | consus-phase7-decision-push-endpoint, `6493896`, merged to `dev` via PR #89 |
| Heuristic decision-type + triage-bucket classification fallback for items without a structured `decision_payload` (prose/keyword regex classifiers: `cba`/`choose`/`survey`/`edit`/`quorum`/`default`; triage buckets `open_question`/`your_action`/`agent_task`/`research_plan`/`noise`) | `backlogged` (design already lifted once, into `docs/delphi-lineage-inventory.md`; also independently implemented once) | Design source: `docs/delphi-lineage-inventory.md` (Claud-ometer's `review-queue.ts`, regexes documented in full). Also independently built once: archived-dev `5ded132` ("fix(REQ-22): legacy heuristic decision-type + triage fallback"). Two independent implementations exist across the lineages; neither is on current mainline. |
| Decision-request 3-tier parser (structured block → heuristic-extracted-from-markdown → none) — roadmap.md's REQ-23 | `backlogged` | `docs/delphi-lineage-inventory.md` Source 2 (`mdostal/delphi`'s `server/parse.mjs`) — reference implementation documented in full. Mainline only implements tier 1. |
| Chat-summarization-on-decide (a decision's write-back carries a discussion summary, not just the verdict) — roadmap.md's REQ-25 | `backlogged` | `docs/delphi-lineage-inventory.md` Source 1 (Claud-ometer's `chat-store.ts` `summarizeChat()`) |
| Decided-store reconciliation-from-audit-log on load, keyed by both a stable key and a linked issue id, distinguishing deciding actions from deferring ones | `backlogged` | `docs/delphi-lineage-inventory.md` Source 1 (`decided-store.ts`). Mainline's `decided_at` is a simpler boolean-ish flag with no reconciliation step — noted as a real gap, not just a nice-to-have, since Consus's `audit_log` is already a queryable SQL table (reconciliation would be a query, not a file-seed, if ever built). |
| Wire live decisions to an external ticket system (Multica or otherwise) | `superseded-do-not-build` | Was built twice — archived-pantheon-coupled (`s1-multica-live-ingest`) and archived-dev (`3e99853`/PAN-7776, `5c2ff82`/PAN-7770, `99f5d57`/PAN-7773). Explicitly rejected direction per tonight's strip: Consus does not sync live from any external system. The "generic push endpoint" item above is the correct decoupled replacement for this capability's actual value (getting decisions INTO Consus from wherever they're produced), without the live-sync coupling. |

## KB collections & knowledge surface

| Item | Status | Source |
|---|---|---|
| KB store with collections (`marketing`/`boundary-decisions`/`plans`/`artifacts`/`general`), audit log, versions | `done` | mainline `server/kb/store.ts`, consus-phase5-live-and-interactive's kb-01 port |
| KB backlog search + collection filtering UI | `done` | mainline `web/src/features/kb/BacklogBrowser.tsx` |
| A second, independently-built KB collection schema + API filter | `superseded-do-not-build` | archived-dev, `afe4c3b` (PAN-6478), `f93d4f1` (kb-02-collection-api). Same capability as mainline's kb-01 — redundant, not a gap. Noting only so it isn't mistaken for missing scope. |
| Multi-project "different areas" — a `project` dimension across items/KB, per-project + cross-project views | `done` | mainline `ProjectsSection`/`ProjectView`/`GlobalView`, roadmap.md's REQ-27 |

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
