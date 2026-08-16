# Consus — Vision & Way of Working

Refreshed 2026-08-13, after the Multica/Minerva/Auriga/Vesta/Votem strip (`4653222`) and the
consus-phase6-standalone-onboarding epic. Supersedes the framing in `.pHive/planning/product-brief.md`,
`product-discovery-brief.md`, `roadmap.md`, `prd.md`, and `architecture.md` wherever they assume
live coupling to another Pantheon system — those documents predate this session's architectural
correction and are kept as historical record (the original v1 pre-code planning pass), not as
current direction. `docs/prior-art.md` and
`docs/delphi-lineage-inventory.md` remain valid as design-lesson sources; their LIFT/REDO calls
mostly still stand, just with "REDO" now meaning "rebuild fully standalone," not "rebuild behind
a swappable adapter to a specific system."

## What Consus is

Consus is the architect tool for any repo. The operator's own framing, verbatim:

> "Consus is basically the architect tool for any repo and once files are indexed we should
> easily be able to open and interact."

Concretely: a local knowledgebase, graph, and file editor for a repo's own decisions, docs, and
architecture, plus a harness-agnostic Q&A surface. That is the whole mission — it does not
extend into being a ticket tracker, a CI dashboard, or a dispatcher for other systems' work.

## The core loop

**Index → open → interact → propose a change → shared-truth KB.**

1. **Index.** An operator-triggered, on-demand scan (`POST /api/projects/:project/ingest`,
   shipped tonight) walks a repo's `.pHive/planning/` and `.pHive/epics/**` for `.md`/`.html`
   files and populates `doc_index`. Deliberately not a background poll — the operator decides
   when to pull in what's changed on disk.
2. **Open.** The per-project view (`ProjectsSection` in `web/src/App.tsx`) shows a project's
   diagram cascade, its docs, and its KB entries together, without opening the repo at a commit
   or digging through files by hand — this was the explicit, first-priority ask that started
   tonight's onboarding epic.
3. **Interact.** Today this means reading a rendered doc (`DocRenderer`) or a diagram cascade
   (`DiagramView`, currently a nested list — see the "diagram engine" gap below) and composing a
   diff. **This is the loop's thinnest link right now** — see the backlog's
   "Architecture-level interact & propose changes" theme for what the archived `dev` lineage
   already built here and Consus's mainline hasn't caught up to yet (an in-place doc editor with
   an explicit edit→fire action, not just a diff-compose box).
4. **Propose a change.** `POST /api/proposals` fires a `{diff, description}` through the generic
   `HarnessTransport` (`server/harness/transport.ts`) — a plain `invoke(method, params)` seam
   with zero knowledge of what's on the other end. The harness applies the change and reports
   back via `POST /api/proposals/:id/result`, which writes the audit-log entry.
5. **Shared-truth KB.** An approved decision or doc becomes a durable, versioned `kb_entries` row
   — the canonical "what happened," grouped by collection (`marketing` / `boundary-decisions` /
   `plans` / `artifacts` / `general`).

## Fixed boundaries

These took the whole session to land on, after a real architectural detour and correction. They
are not open questions going forward:

- **Standalone-only. Zero live coupling to Multica, Minerva, Auriga, Vesta, Votem, or any other
  specific external system.** Consus's server has no adapter directory for any of them
  (`server/adapters/` contains only `doc-scanner/`). This was true before tonight in spirit and
  is now true in the code — the strip removed every adapter, transport, and client class that
  named a specific system.
- **Cross-plugin integration is future Pantheon L2 adapter work — not Consus's own codebase
  reaching out.** The operator's own words: "When it is in the hive, we use the l2 pantheon
  defined lifecycle and adapters for stuff but all of that is in there and no direct ties between
  plugins, they will pass through the pantheon for those sorts of things to enable the multi
  system integration — we will get there." Consus does not grow a Multica client, a Minerva
  bridge, or any other system-specific integration inside its own repo again. If/when that
  integration exists, it lives in Pantheon's L2 layer and talks to Consus over the same generic
  seams (`HarnessTransport`, plain REST) any other harness would use.
- **Harness interaction only through the generic seam.** `HarnessTransport` is the sole
  integration point for "propose a change and let something apply it." It has no knowledge of
  what's configured on the other end (a CLI command, by default). The agent-facing
  `skills/consus/SKILL.md` document is the read/write contract for any Claude-Code-compatible
  harness, standalone or Pantheon-plugin mode — extending it (not inventing a parallel channel)
  is how new capabilities get exposed to outside agents.
- **Local-only.** `127.0.0.1` binding on both the Vite dev server and the Fastify server, no
  tailnet/network exposure. This was explicitly re-affirmed tonight after finding the dev server
  briefly reachable over tailscale.

## Way of working

- **Planning.** `/plugin-hive:plan` — research grounded in the actual codebase (not guessed),
  a design discussion with open questions surfaced to the operator, story decomposition with
  dependency tracking, self-contained story YAMLs an agent can execute without re-deriving
  context. Scope calls (small/medium/large) drive how much ceremony a given change gets; tonight's
  onboarding epic and the CBA-push epic discussion both stayed intentionally thin for their size.
- **Execution.** `/plugin-hive:execute` — stories run in dependency order. Stories that touch the
  same file stay serial by convention (both s2 and s3 of the onboarding epic touched
  `web/src/App.tsx` and were explicitly kept sequential rather than parallel). Real automated
  tests are written and run before a story is considered done — not just claimed done.
- **Git branching.** `dev` is the integration branch. Feature branches cut off `dev`, merge back
  into `dev`, and `dev` promotes to `main` for releases via the `promote.yml` GitHub Action (an
  auto-opened dev→main PR, never auto-merged). Tonight this was corrected after discovering `dev`
  and `main` had diverged badly on `origin` — `dev` was carrying a 114-commit parallel history
  from a different machine that had re-coupled to Multica/Minerva, while `main` carried this
  session's own PR-based history including tonight's strip. The old `dev` tip is preserved at
  `archive/dev-2026-08-11-pantheon-coupled`; `dev` was reset to match `main`'s clean, stripped
  lineage, and the standard flow (feature → dev → main) applies from here forward.
- **Acceptance testing.** UAT checklists are written as real markdown docs under
  `.pHive/planning/` — GFM checkboxes, checked off in place as items are verified, viewable
  inside Consus itself once ingested (precedent: `.pHive/planning/uat-standalone-onboarding.md`,
  written and partially verified live tonight against the running app). This is the same
  "bubble it up in Consus" principle applied to acceptance testing as to everything else Consus
  is supposed to surface.
- **This document and the backlog it pairs with** (`.pHive/planning/backlog.md`) are themselves
  ingestable planning docs — they show up in Consus's own Docs/per-project view once scanned,
  same as any architecture doc or PRD. Refresh them as reality changes; don't let them calcify
  into aspirational fiction the way `roadmap.md`'s Minerva/Auriga/Vesta framing did.

## What's backlogged, not built

**PR/branch-level CBA and docs surfacing.** The operator's own framing, verbatim:

> "When a PR is made, same thing, we should be able to easily open and interact with the PR
> level CBA or docs or decisions at some point (but we can leave the PR part out for now and
> keep it 0) we need that as most of the work is going to be in progress and across branches as
> it comes in."

This is explicitly **status: not-started, priority: later** — not scoped for near-term building.
The rationale is sound and worth keeping visible: most future work will be in-progress and spread
across feature branches before it ever reaches `main`, so eventually Consus needs a way to surface
that in-flight work (a branch's docs, a PR's CBA, an open decision tied to work-in-progress) the
same way it surfaces settled, merged-to-main state today. See the backlog's dedicated theme for
the single tracked entry — do not expand it into a design or a story until the operator explicitly
asks.
