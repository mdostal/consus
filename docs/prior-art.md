# Delphi — Prior Art (seed for the greenfield build)

> **Renamed 2026-07-25: the project this doc informed is now called Consus** (see
> `docs/consus-definition.md`, `docs/north-star.md`). Every "Delphi" / `/delphi` reference
> below is preserved as-is because it describes the **actual prior codebase's real names**
> (routes, file paths, storage keys on the hive host) — renaming them here would misstate
> where that code actually lives. Read "Delphi" throughout this doc as "Consus's
> predecessor," not as this project's current name.

_Purpose: this doc exists so `/hive:plan` **pulls apart the prior Delphi work** instead of
starting from a blank page. There is a real, Playwright-verified prior `/delphi` surface and a
large body of accumulated design decisions. Read this first; mine the prior code where it says
LIFT, rebuild clean where it says REDO._

> Provisional name. "Delphi" renames once it works — don't over-invest in the branding.
> (It did: this project is now Consus.)

---

## 0. Where the prior code lives (READ-ONLY reference — do not modify it)

- **Prior implementation:** the `/delphi` route inside the **Pantheon host app**, legacy repo name
  **`Claud-ometer`** (Next.js App Router). It is NOT on this laptop's `~/Code/Claud-ometer` (that
  checkout is on `main`, no delphi). It lives **on the hive**:
  `ssh <internal-dev-host>` → `~/Documents/work/dostal/code/Claud-ometer`.
- **Most complete branches:** `feat/pantheon-gigs-tab` and `feat/delphi-render-cbas` (9 delphi
  files each). Earlier milestones: `feature/pantheon-v1` (the original "Human Decision Surface"
  rebuild, commit `91e724e`), `feat/delphi-diagram-review`, `fix/delphi-surfacing`.
- **Design source (the mockup that started it):** `docs/delphi-mockup.html` — artifact
  `43f31ec9-80e5-449d-83af-dc82ef0009dd`. Each of its ~6 sections was a REAL decision ticket
  wireframed as a stand-in, not a design sample.

### Prior file map (on the hive, under `Claud-ometer/`)

| File | Lines | Role |
|---|---|---|
| `src/app/delphi/page.tsx` | 2577 | The whole surface: home dashboard + question-forefront decide panel + all decision-type renderers. Client component. |
| `src/app/delphi/delphi-css.ts` | 421 | Inlined CSS (design tokens `--accent/--warn/--good/--info/--ink-*`). |
| `src/app/delphi/diagram-view.tsx` | 154 | React Flow (xyflow, MIT) DAG viewer for architecture attachments. `ssr:false` dynamic import. |
| `src/lib/delphi/review-queue.ts` | 1316 | Multica fetch + lane classify + **decision-type classifier** + **triage-bucket classifier** + action execution (real Multica writes) + audit/KB append. |
| `src/lib/delphi/decision-request.ts` | 169 | **`dostal:decision-request/v1`** — the STRUCTURED decision schema (the newest, best pattern). Pure, parses a fenced JSON block from a ticket body. |
| `src/lib/delphi/extract.ts` | 718 | Prose-ticket → structured decision (question + choices + CBA table + answer-shape). Gemini-backed w/ heuristic fallback, disk-cached. |
| `src/lib/delphi/decided-store.ts` | 185 | Persists decided state so decided items don't re-surface (the "amnesia fix"). |
| `src/lib/delphi/verified-buckets.ts` | 62 | Human-authored override map (`~/.multica/delphi-verified-buckets.json`) that beats the heuristic. |
| `src/lib/delphi/chat-store.ts` | 70 | Per-item discussion thread persistence. |
| `src/app/api/delphi/**` | ~500 | Routes: `review-queue`, `[id]/{action,approve,detail,attachment,chat,extract}`, `audit`, `knowledgebase`. |

Persistence today = flat files under `~/.multica/`: `delphi-audit.jsonl`,
`delphi-knowledgebase.jsonl`, `delphi-verified-buckets.json`, extraction cache, chat store.

---

## 1. What the prior `/delphi` surface does

It was rebuilt from a one-button rubber-stamp ticket list into a **split-desk Human Decision
Surface**: queue · artifact panel · attachments+audit rail. Core reframe (KEEP this): **every
queue item IS the artifact** (a CBA / doc / options / diff), read + edited + decided in-panel —
"open it, read it, decide it, send it back," not a ticket forwarder. Verified Playwright 13/13 at
`https://hive.tail9a130d.ts.net/delphi`.

### Two views
- **`home` — the command dashboard:** status tiles (Needs you · In review · Decided · Throughput
  last-7d, from the audit log) · a **"Your quick actions"** strip · a **Needs-you shortlist** ·
  the **open queue rendered as a by-bucket chart** (not a flat list) · a decision-log timeline ·
  a CBAs section. Clicking anything opens the full question panel.
- **`decide` — question-forefront panel:** the exact QUESTION at the top, the CHOICES as
  first-class controls, prose demoted to a collapsible "Context" block, attachments + audit rail
  on the side, a discussion/chat thread inline.

### The decision types (the "~6", classified heuristically — `classifyDecisionType`)
Order matters; first match wins; most items fall to `default` and that's fine.

| Type | Label / kicker | Primary interaction |
|---|---|---|
| `cba` | "CBA approval" · COST–BENEFIT ANALYSIS | Renders the CBA table + chart; Approve→build / Request changes / Send to quorum. |
| `choose` | "Choose 1 of N" · CHOOSE AN OPTION | Option cards, pick one; Select this option / Compose hybrid → send. |
| `survey` | "Multi-select" · FEATURE/STYLE SURVEY | Checklist, pick any; Send selections. |
| `edit` | "Edit + diff" · REVIEW & AMEND | Inline green-add/red-strike **line-diff editor**; Send edits back / Approve as-is. |
| `quorum` | "Your decision" · agent input below | Human decides with agent votes shown; routes to votem when policy says quorum. (Tiebreak framing was deliberately killed — see below.) |
| `doc` | "Read the doc" · approve as-is or discuss | Renders a finished deliverable doc; Approve as-is / Request changes. |
| `default` | "Decision" · ARTIFACT · YOUR CALL | Plain artifact view + real action verbs. |

Orthogonal to type, an **AnswerShape** (`extract.ts`) drives which PRIMARY control shows so the
real choice + a real Submit appear (never a lone "Approve"): `yes_no` → YES/NO+Submit,
`choose_one` → option cards, `survey` → checklist, `edit` → redline, `approve` → the only true
greenlight case.

### Triage buckets — "is this actually a human decision?" (`classifyBucket` + verified override)
The killer feature. 200 mis-routed items collapse to what needs YOU:
`open_question` (**Needs you** — surfaced first) · `your_action` (quick hands-on task) ·
`agent_task` (**In the swarm** — should run, not be decided) · `research_plan` · `noise`
(**Archive**). A human-authored `delphi-verified-buckets.json` **overrides** the heuristic so ops
/ stale garbage never reaches Needs-you and genuine decisions always do.

### What visibly works (KEEP)
- **Split-desk + question-forefront + artifact-is-the-item** reframe. This is the product.
- **Triage bucketing** so the operator opens to ~6 real decisions, not 200.
- **Actions wired to REAL Multica writes** (not a mock): Approve→`PUT status=todo` (**greenlight
  work, build+verify — NOT "done"**); Defer / Request-changes / Send-edits / Select / Compose →
  rationale-or-redline comment + status transition. A latent bug was fixed here (old approve used
  PATCH → 405 → silent CLI fallback → approve was actually broken).
- **`dostal:decision-request/v1`** structured renderer — deterministic native decision UI
  (surveys, tables, evidence) from a JSON block, NOT scraped prose or an iframe. **This is the
  best pattern in the codebase** and the direction the whole thing was heading.
- **Inline line-diff editor** for edit/amend decisions.
- **Append-only audit log** + **decided-store** (decisions don't re-surface / amnesia fixed).
- **Approve FIRES OFF + KB landing** — approve writes the decision + doc into the knowledgebase.
- **Attachment preview modal** + **React Flow DAG viewer** (architecture diagrams reviewed
  in-app, not dead PNGs; xyflow chosen because we own the graph JSON → structural diff is trivial).
- **Chat/discuss thread per item** (the "discuss + iterate WITH the content" path).

### What to REDO (do not carry forward as-is)
- **All persistence is flat files in `~/.multica/*.jsonl`.** The accumulated design calls for a
  **real DB with audit log + versions + its own state**. Rebuild the storage layer clean.
- **Heuristic + hardcoded identifier classification.** `review-queue.ts` hardcodes
  `KNOWN_HUMAN_IDENTIFIERS` / `FORCE_INCLUDE_IDENTIFIERS` (DOS-703, DOS-1091, …) and a
  `verified-buckets.json` hand-patch. That was firefighting a specific 96-item backlog — do NOT
  port the hardcoded IDs. Keep the *bucket concept*; rebuild classification generically (ideally
  driven by the `decision-request/v1` contract at the source, not scraping).
- **Everything welded to Multica in-review tickets.** The greenfield vision is a standalone
  artifact/doc surface for **any** agentic harness (reads `.md`/`.pHive/planning/`), multi-project.
  The prior code assumes "the queue = Multica member-assigned in_review issues." Decouple the
  source behind an adapter.
- **`extract.ts` uses `gemini-2.5-flash`** — a BANNED tier per model-alignment (no 2.x / no flash
  for real work). Re-point extraction at a current premier model, config-driven.
- **2577-line `page.tsx` monolith.** Home, decide panel, and every type renderer live in one
  client file. Rebuild as composed per-decision-type components (plug-and-play).
- **No auto-redeploy, single-`:3002`-deploy contention, Board tab proxy gap** — host-integration
  scars, not product; ignore for the greenfield.
- **"Delphi ↔ Pantheon" coupling** was implicit. Greenfield ships as its own repo/plugin that can
  run standalone.

---

## 2. Accumulated design decisions (from memory + specs — the north star)

_Sources: `delphi-definition.md`, `delphi-product-spec.md`, and memory files
`delphi-is-the-ideation-signoff-process`, `delphi-decision-surface-live`, `delphi-cba-and-knowledge-base`,
`decision-approval-flow-standard`._

**Delphi is the PROCESS, not just a screen.** The loop: **ideate → create → iterate →
sign-off/approve**, including the CBAs and the back-and-forth Q&A. The orchestrator *runs* the
loop; humans *view and decide* through Delphi. The surface merely renders the process.

### #1 requirement — the READ / VIEW surface (this is WHY Delphi exists)
The acute pain: **you cannot read the swarm's generated docs in a shell session** — briefs / PRDs
/ architecture / plans / CBAs / specs are `.md`/`.html` on the box. The manual workaround today is
Claude pulling each doc off the hive and rendering it as an Artifact. **Delphi = that,
productized:** a readable, rendered surface for every generated artifact + every decision. The
view surface is priority #1; the decision surface is #2.

### Approval policy is CENTRAL — never per-plugin
- **Vesta owns the SETTING** (the knob): the approval policy, scoped global / per-repo /
  per-decision-type/risk. Set once.
- **Delphi is the SURFACE + ENFORCER**: reads the policy, renders docs/diagrams,
  **auto-accepts until it hits something the policy flags** (strategic / ambiguous / irreversible),
  then surfaces the human gate. (Mathew doing yes-yes-yes manually → Delphi does it per-policy.)
- **votem is the MECHANISM** Delphi routes to when policy says "quorum."
- **Plugins just EMIT "this needs a decision" and DEFER** — they never own the mode. Standalone
  fallback: a plugin outside Pantheon carries a local default (auto / bare gate).
- Net: **Vesta = the knob · Delphi = surface/enforcer · votem = the quorum tool · plugins =
  emit-and-defer.**

### Consumer-app + docs/knowledge-center vision
- Framed primarily as a **consumer-facing app** (also a framework, also a plugin, also has
  services). **Has a UI. Metrics opted IN.**
- **THE PITCH: it replaces the documentation + knowledge-center for a dev team.** Holds **MANY
  projects underneath**, each with its own view + a high-level cross-project view.
- **Ships as a GitHub release into the Pantheon**, but can **live STANDALONE** to surface
  artifacts for **any agentic harness** (e.g. Claude Code writing `.md` files it interacts with).
- Requires **skills the agent interacts with** to reference + **mark/update statuses**.
- The **status/state section needs its OWN storage/state** — lookup + metadata over decisions,
  **long-lived docs**, and **living diagrams/documentation** that update over time.

### The "Delphi section" — CBA / knowledge base
- **ALL CBA reviews route to a Delphi CBA section.** Once a CBA / doc / architecture is **approved**
  it becomes **shared truth / the knowledge base** — the canonical, referable "what happened."
- Every repo's `docs/initial-info/` + CBAs seed it (pattern set on pantheon-orchestrator).
- First seed artifacts: the orchestrator CBA `403f7c30…`, plan `00372e22…`, kickoff brief
  `7305504f…`.

### The approve-flow STANDARD (how sign-off must work)
1. **Present the content, two first-class paths:** (a) pick/approve AS-IS, or (b) discuss +
   feedback + iterate WITH the content in the ticket (chat/compose-hybrid). Visual choices show
   the **ACTUAL previews** rendered inline (e.g. 6 styles × 6 layouts), not text.
2. **Approve FIRES OFF** — break approved items out **by phase** (1 = build now, 2 = later,
   leaves = reference); create phase-1 tasks. Approve = "go-build," never "done."
3. **Write to the knowledgebase** — the decision + full doc + each item (verdict + phase) lands in
   the Delphi Knowledge section + the KG, referable later.
4. **Delphi AND/OR client-facing** — the same decision can surface for Mathew OR for a client.
5. **Every deep-dive / research / CBA produces this level** — full doc + broken-out items +
   phasing + approve/why-not + KB landing, not a thin summary.

### Bootstrap ordering
Formal plan→Delphi approval routing fires **once the orchestrator's first slice is solid** —
because the orchestrator is what *runs* Delphi. Until then, Mathew + Claude ARE Delphi (manual).

---

## 3. Reuse vs. rebuild recommendation for the fresh build

### LIFT (port the pattern, and often the code, from the hive `Claud-ometer`)
1. **The product reframe itself** — split-desk, question-forefront, **artifact-IS-the-item**,
   prose-demoted-to-context. This is proven and loved; make it the baseline UX.
2. **`decision-request.ts` (`dostal:decision-request/v1`) — port nearly verbatim.** It is pure,
   dependency-free, and it's the correct architecture (structured decision object → deterministic
   native renderer, "code-driven with AI assistance"). Make it the *primary* contract, not the
   fallback. Extend it to carry the view-surface docs and phasing/KB metadata.
3. **The triage-bucket concept** (`open_question / your_action / agent_task / research_plan /
   noise`, Needs-you first) — lift the concept and the bucket labels/ordering. **Rebuild the
   classifier generically** (drop the hardcoded DOS-IDs).
4. **The home command dashboard layout** — status tiles, Needs-you shortlist, open-queue-as-chart,
   decision-log timeline, CBAs section. Good IA; re-implement as clean components.
5. **The action semantics** — Approve = greenlight WORK (→ build+verify, never "done"); the
   approve→phase-split→KB fire-off. Keep the verb set and the "two ways to act" (approve-as-is vs
   discuss/compose-hybrid).
6. **The inline line-diff editor** and the **React Flow DAG viewer** — both are reusable, harness-
   agnostic components. Lift the diagram-view (xyflow / MIT) and its "we own the JSON → structural
   diff" rationale directly.
7. **The design tokens / CSS** in `delphi-css.ts` (accent/warn/good/info/ink scale) — a fine
   starting palette to carry into the brand-system step.

### REBUILD CLEAN (do not port)
1. **Persistence → a real DB.** Replace all `~/.multica/*.jsonl` flat files with a proper store:
   audit log + **decision versions** + the **own state** the vision demands (statuses, long-lived
   docs, living diagrams, multi-project). This is explicitly called for.
2. **The source/data layer → an adapter, not hardwired Multica.** The greenfield reads generated
   artifacts from **any harness** (`.pHive/planning/`, `docs/`, idea board) and is **multi-project**.
   Multica-in-review becomes *one* adapter behind an interface, not the spine.
3. **Classification** — generic, contract-first (prefer emitting `decision-request/v1` at the
   source over scraping prose). Delete `KNOWN_HUMAN_IDENTIFIERS` / `FORCE_INCLUDE_IDENTIFIERS` /
   the verified-buckets hand-patch — those were backlog-specific firefighting.
4. **Approval-policy enforcement** — build it as **read-from-Vesta / route-to-votem** from day one
   (the prior surface hardcoded the human gate; the policy engine never existed). Delphi =
   surface+enforcer, not the owner of the mode.
5. **The `page.tsx` monolith → composed per-type components** (plug-and-play, each decision type
   its own module). The prior 2577-line file is a reference for behavior, not a structure to copy.
6. **The read/VIEW surface as a first-class pillar.** The prior build was decision-first and only
   grew doc-rendering later; the greenfield must build the **view surface (priority #1)** as its
   own pillar — browse every generated doc by project/repo/epic/phase — with the decision surface
   layered on top.
7. **Re-point AI extraction** off `gemini-2.5-flash` to a current premier model, config-driven and
   UI-transparent (model-alignment standard). Keep the heuristic fallback so it's never blank.

### One-line call
**Lift the *product* (the reframe, the `decision-request/v1` contract, the triage buckets, the
dashboard IA, the diff/DAG components); rebuild the *plumbing* (real DB + own state, a harness-
agnostic source adapter, generic contract-first classification, Vesta/votem policy wiring); and
add the missing *pillar* (the read/view doc surface + multi-project) that the prior decision-first
build never fully grew.**
