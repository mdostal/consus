# Consus — Vision

Consus is the Pantheon's **ideation → sign-off loop** and its **human surface**. The orchestrator *runs* the loop; humans *view and decide* through Consus. This doc is the trajectory — three rungs. Contributors can pick one.

> **Provisional name.** "Consus" (Roman god of the granary / secret counsel) renames once it earns its keep — don't over-invest in the branding.

---

## ① Current — where it is now

Consus runs as a **Fastify server on `:8722`** backed by a local **SQLite** file (`.pHive/consus.sqlite`), started with `npm run dev` (server + Vite web) or `npm start` in production. It is **dual-mode**: the same routes serve it standalone or as a Pantheon plugin.

**What actually works (live + tested — ~109 tests, TDD backend / BDD UI):**

- **HTTP API** — `GET /health`, `GET /api/decisions` (open, undecided decision-requests), `POST /api/items/:id/decide` (verdict → append-only audit log, marks decided), `GET /api/docs` + `/api/docs/content` (generated docs grouped repo→phase→doc, cross-project or scoped), `GET/PUT /api/kb-entries` + `/versions`, and artifact-link routes. Full contract in [`docs/api-reference.md`](docs/api-reference.md).
- **Store** — idempotent SQLite migration; `items`, `audit_log`, `doc_index`, `kb_entries` with **append-only versioning** (a decided item never loses history — the "decided-store amnesia" fix).
- **Decision contract** — a `dostal:decision-request/v1` parser + classifier (options A–Z, tradeoffs, required `recommended`, four-verdict model) and a decision-type taxonomy with triage buckets.
- **Doc scanner** — indexes generated `.pHive/planning/` docs across configured repos.
- **Sibling-god adapters** — Minerva (question bridge + survey batching), Multica (comment read/write), Auriga (read-only tracker state), Vesta (policy reader), Votem (quorum router).
- **Web feature components** — theme-aware `DecisionCard`, `DocRenderer`, `QAQueue`/`SurveyGroup`, `KBBrowser`/`BacklogBrowser`, `CommentThread`, `ProjectView`/`GlobalView`, answer-shape controls. All built and unit-tested.

**Honest stubs / gaps right now:**

- **The SPA shell isn't assembled.** `web/src/App.tsx` is a placeholder (`<h1>Consus</h1>`) — the tested feature components aren't yet wired into a navigable app.
- **Rendering is markdown-only.** `DocRenderer` uses `marked`; **no mermaid** — fenced diagrams render as code, not diagrams.
- **Minerva answer-back and comments are internal-only.** `answerHumanRequest` / `getSurveyProgress` and the Multica comment writer are callable server-side but have **no HTTP route** yet — a harness can *read* open questions via `/api/decisions` but can't submit a Minerva-native answer through the documented API.
- **Idea board** is flagged as a follow-up, not built.

---

## ② Goals — near-term next steps

1. **Assemble the SPA shell** — wire the existing, tested components into `App.tsx`: a navigable surface with doc browser, decision queue, Q&A queue, and KB views. This is the single biggest unlock — the components already exist and pass tests.
2. **Full inline render** — add **mermaid** to `DocRenderer` alongside `marked` so architecture/diagram-bearing docs render as diagrams, plus **attachments** on items/decisions. (Long-standing render-gap item.)
3. **Kill the junk unblock-decision flood** — surface real, actionable decisions from *items*, not a noisy board-view firehose of synthetic "unblock" prompts.
4. **Expose the internal-only flows over HTTP** — routes for the Minerva answer-and-sync-back flow and for comments, so the whole loop is drivable via the documented API (not just server-side code).
5. **Wire decisions to fire work** — an approval routes `go-build` into the orchestrator and the approved doc lands in the KB, closing ideate→sign-off→execute.

---

## ③ Long-term vision — where it grows to

**Consus becomes the whole ideation → sign-off loop, productized** — not just a screen that renders docs, but the process the Pantheon runs to turn an idea into approved, built work:

> **ideate → create → iterate → sign-off / approve**

- **The complete loop, in one surface.** Frame an idea (from an idea board, a request, a KPI drop) → research/CBA it → the back-and-forth Q&A that sharpens scope → a full-spec document → sign-off that **fires the work off**. Today this loop runs *by hand* (Mathew + Claude are Consus); Consus is the machine that runs it.
- **A shared-truth knowledge base.** Every approved CBA, doc, and decision becomes durable KB — versioned, searchable, cross-project — so decisions are grounded in what's already been decided, and each repo's `docs/initial-info/` + CBAs seed it.
- **Real agent discussion.** A genuine discussion thread on every decision — not just a human answer slot, but agents proposing, critiquing, and defending options in the open before sign-off.
- **CBA-driven, KPI-aware.** Every significant idea gets a cost-benefit review before build; every shipped decision carries KPIs and a later evaluation.

### Platform-wide direction

Consus is one **swappable capability slot** in Pantheon. The whole platform is built to let you **toggle any language, model, plugin, or god on/off and compare metrics at every step** — Consus's decision surface is where those comparisons surface for a human to judge, and Consus itself can be swapped for a different implementation of the same slot without touching the rest of the stack.

---

## Good first contributions

- **Wire `App.tsx`** — assemble the existing tested components into a navigable shell (routing + layout). Highest-impact starter.
- **Add mermaid to `DocRenderer`** — render ```mermaid fences as diagrams alongside `marked`; keep the scoped-scroll container for wide diagrams.
- **HTTP route for comments** — wrap `server/adapters/multica/write-comment.ts` in a Fastify route with tests.
- **HTTP route for Minerva answers** — expose `answerHumanRequest` / `getSurveyProgress` (`server/adapters/minerva/`) so the Q&A loop is fully API-drivable.
- **Attachments on items** — schema + route + a card affordance.
- **Docs/tests** — extend `docs/api-reference.md` as routes land, and add BDD coverage for any newly-wired UI.

New here? Read [`docs/north-star.md`](docs/north-star.md) and [`docs/consus-definition.md`](docs/consus-definition.md) for the why, then [`docs/api-reference.md`](docs/api-reference.md) for the contract. Everything is TDD/BDD — land a test with your change.
