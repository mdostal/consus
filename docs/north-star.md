# Delphi — Product Spec (seed for kickoff)

_Provisional name "Delphi" (renames once it works — don't over-invest in the branding). Seed
this into the delphi repo's `docs/north-star.md` when we `/hive:kickoff` it — soon (target: this
weekend, alongside standing up the Pantheon)._

## What Delphi is
The Pantheon's **ideation → sign-off PROCESS** *and* its **human surface**. The loop:
**ideate → create → iterate → sign-off/approve**, including CBAs and the back-and-forth Q&A.
The orchestrator *runs* the loop; humans *view and decide* through Delphi.

## THE ACUTE PAIN (the #1 requirement — this is why Delphi exists)
**You cannot read the swarm's outputs in a shell session.** `/hive:kickoff` / `plan` / `execute`
generate briefs, PRDs, architecture docs, plans, CBAs, and specs as `.md`/`.html` on the box —
**unreadable in the terminal.** Today the workaround is Claude manually pulling each doc off the
box and rendering it as an Artifact (e.g. the pantheon-orchestrator kickoff brief). **Delphi is
that, productized:** a readable, rendered surface for every generated artifact + every decision.

## Requirements
1. **Read/view surface (top priority)** — render every generated doc (briefs · PRDs · architecture
   · plans · CBAs · specs · `docs/initial-info/`) cleanly; browse by repo / epic / phase.
2. **Decision surface** — approve / discuss / iterate / sign-off (the 6 decision types); **approve
   FIRES OFF work + becomes KB** — it is "go-build," not "done."
3. **Q&A / ideation loop** — surface the swarm's questions (kickoff/plan/CBA gates), answer them,
   iterate; the back-and-forth that turns an idea into approved work.
4. **CBA / KB — the "Delphi section"** — approved CBAs / docs / decisions become shared-truth KB;
   every repo's `docs/initial-info/` + CBAs seed it (pattern established on pantheon-orchestrator).
5. **Feeds from** — the repos' `.pHive/planning/` docs + the orchestrator's ideation + the idea board.
6. **Pluggable + swappable** — a Pantheon plugin, its own repo (`mdostal/delphi`).

## Bootstrap ordering
Delphi fires **once the orchestrator's first slice (P0+P1) is solid** — because the orchestrator is
what runs the loop. Until then, **Mathew + Claude ARE Delphi (manual)**. First real package to load:
the pantheon-orchestrator **CBA + plan + `initial-info` + the kickoff briefs**.

_Artifacts to seed the KB: CBA `403f7c30…` · Plan `00372e22…` · Kickoff brief `7305504f…`._

## Rendering requirement — the artifact UI (Mathew 2026-07-25)

Delphi's document/decision rendering surface **should use the artifact-UI pattern prototyped in this session** — clean, **theme-aware** (light/dark), readable HTML surfaces that render generated docs, deep-dives, and go/no-go decisions. See the precedents built by hand tonight: the **CADEX deep-dive**, the **gig go/no-go**, and the **Delphi/Heimdall setup** artifacts.

**Those artifacts ARE the manual Delphi output** — hand-rendered only because Delphi doesn't exist yet. Delphi productizes exactly that: every generated artifact + every decision rendered as a **readable, navigable surface** (not a terminal, not raw markdown). Baseline UX requirements drawn from those precedents:
- Real typographic hierarchy; theme-aware tokens (light + dark).
- **Decision cards** — a question + a recommendation + an answer slot (the go/no-go pattern).
- Status/severity pills (P0/P1, in-flight/dropped, ready/seed).
- Collapsible source docs; scannable tables; scoped-scroll for wide content.
- One readable page per artifact — the thing you review instead of scrolling a shell.
