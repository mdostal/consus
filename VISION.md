# Consus — Vision

Consus is **the architect tool for any repo**: a local knowledgebase, graph, and file editor for a
repo's own decisions, docs, and architecture, plus a harness-agnostic Q&A/decision surface. Once a
repo's `.pHive/` planning tree is indexed, you should be able to easily open and interact with it —
that's the whole mission. It does not extend into being a ticket tracker, a CI dashboard, or a
dispatcher for other systems' work.

> **Provisional name.** "Consus" (Roman god of the granary / secret counsel) renames once it earns
> its keep — don't over-invest in the branding.

Consus went through a real architectural correction to get here: it briefly grew live integrations
with several other systems, and that coupling was fully stripped back out. That correction is now
a fixed boundary, not an open question (see below).

---

## ① Current — where it is now (v0.6.0)

Consus runs as a **Fastify server on `:8722`**, bound to `127.0.0.1` by default, backed by a local
**SQLite** file (`.pHive/consus.sqlite`), started with `npm run dev` (server + Vite web) or
`npm start` in production.

**What actually works (live and tested):**

- **HTTP API** — `GET /health`; `GET`/`POST /api/decisions` (read the open queue, or push a new
  decision/CBA in); `POST /api/items/:id/decide` and `POST /api/decisions/:id/verdict` (record a
  verdict, append-only audit log); `GET /api/items/:id/comments` + `POST` (comment threads);
  `GET /api/docs` + `/api/docs/content` (generated docs, repo→phase→doc); `GET /api/projects` +
  `POST /api/projects/:project/ingest` (on-demand indexing); KB routes including draft/submit
  separation and versioning; `POST /api/proposals` + `/result` (propose a change, fire it to a
  harness); `GET /api/diagrams` (epic/story cascade); `GET /api/items/:id/audit-trail`; artifact
  links. Full contract in [`docs/api-reference.md`](docs/api-reference.md).
- **Store** — idempotent SQLite migration; `items`, `audit_log`, `doc_index`, `kb_entries`,
  `kb_versions`, `proposals` with append-only versioning (a decided item never loses history).
- **Decision contract** — a `dostal:decision-request/v1` parser (options A–Z, tradeoffs, required
  `recommended`), with tiered extraction (structured block vs. heuristic-from-prose, tagged via
  `extractionTier` so a guess isn't surfaced with the same weight as a deliberate decision).
- **Doc scanner** — the only adapter in the codebase (`server/adapters/doc-scanner`); indexes a
  repo's own `.pHive/planning/` and `.pHive/epics/**` on an operator-triggered ingest.
- **Diagram cascade** — real Mermaid-rendered epic/story dependency trees, click-to-detail on story
  nodes, built client-side from `GET /api/diagrams`.
- **Propose-a-change** — the sole write path into a repo's own content. A diff + description goes
  through the generic `HarnessTransport` (`server/harness/transport.ts`); a harness applies it and
  reports back. Defaults to a no-op unless a local command is configured.
- **Web SPA** — `web/src/App.tsx` is assembled and wired: a per-project view showing a project's
  diagrams, docs, and KB entries together, an in-place doc editor with section-scoped diffs and a
  "Fire to harness" action, and a first-run onboarding screen for a fresh install.

**Honest gaps right now:**

- **Interact is the loop's thinnest link.** Today "interact" means reading a doc or diagram and
  composing/firing a diff — a real in-place editor exists for docs, but the fuller
  architecture-level interact-and-propose experience the archived `dev` lineage explored is still
  ahead of the current mainline. See `.pHive/planning/backlog.md`'s "Architecture-level interact &
  propose changes" section.
- **Single-repo doc resolution.** The doc scanner walks one configured repo's own `.pHive/` tree;
  resolving docs across every repo under a code root is backlogged, not built.
- **PR/branch-level surfacing is not started.** Most work-in-progress lives on feature branches
  before reaching `main`; surfacing a branch's or PR's own docs/CBA/decisions the way merged-to-main
  state is surfaced today is a real, explicitly deferred item — see the backlog's dedicated theme.

---

## ② Goals — near-term next steps

1. **Strengthen "interact."** Push further on architecture-level interaction — not just editing a
   doc's text, but interacting with the diagram/decision graph itself.
2. **Multi-repo doc resolution.** Resolve a doc path across every repo under a code root, not just
   one repo's own tree (a reference implementation already exists in prior lineages to learn from,
   not port as-is).
3. **Decision-type/triage classification, wired in.** The heuristic classifier
   (`server/decision-contract/classifier.ts`) exists and is tested but isn't called from any route
   yet — `decision_type`/`triage_bucket` are always `null` on decisions returned today.
4. **Keep the harness-facing surface current.** `skills/consus/SKILL.md` and
   `docs/api-reference.md` are the read/write contract for any Claude-Code-compatible harness —
   extend them (never invent a parallel channel) as new capabilities land.

---

## ③ Long-term vision — where it grows to

**Consus becomes the whole index → open → interact → propose → shared-truth loop, fully
productized for any repo** — not just a screen that renders docs, but the tool that makes a
repo's own architecture legible and editable without digging through files by hand.

- **A shared-truth knowledge base.** Every approved decision, CBA, and doc becomes durable,
  versioned, searchable KB — grounding future decisions in what's already been decided.
- **PR/branch-level surfacing.** Extend today's merged-to-main view down to in-progress,
  cross-branch work, once there's real demand to scope it.
- **Cross-system integration stays out of Consus's own codebase.** If Consus ever needs to talk to
  another system, that integration lives one layer up (e.g. a future Pantheon L2 adapter) and
  reaches Consus over the same generic seams — `HarnessTransport`, plain REST — any other harness
  would use. Consus itself does not grow a client for any specific external system again.

### Fixed boundaries

These are settled, not open questions:

- **Standalone-only.** Zero live coupling to any specific external system — `server/adapters/`
  contains only `doc-scanner/`.
- **Harness interaction only through the generic seam.** `HarnessTransport` is the sole
  integration point for "propose a change and let something apply it," with no knowledge of what's
  configured on the other end.
- **Local-only by default.** `127.0.0.1` binding on both the Vite dev server and the Fastify
  server unless explicitly overridden. The production server reads `HOST` (default `127.0.0.1`)
  so a containerized deploy can bind `0.0.0.0` — nothing changes for anyone who doesn't set it.
  Not a network-exposure-by-default policy shift, just an explicit opt-in for a deliberate deploy.

---

## Good first contributions

- **Wire the decision classifier** — call `classifyItem` from the decisions routes so
  `decision_type`/`triage_bucket` are populated instead of always `null`.
- **Multi-repo doc resolution** — extend the doc scanner past a single configured repo.
- **Architecture-level interact** — push past diff-compose editing toward richer interaction with
  the diagram/decision graph itself.
- **Docs/tests** — extend `docs/api-reference.md` as routes land, and add tests for any newly-wired
  UI.

New here? Read [`.pHive/planning/vision-and-way-of-working.md`](.pHive/planning/vision-and-way-of-working.md)
and [`.pHive/planning/backlog.md`](.pHive/planning/backlog.md) for the fuller current-state picture,
then [`docs/api-reference.md`](docs/api-reference.md) for the HTTP contract. Land a test with your
change.
