# Consus

**The Pantheon's rendered doc & decision surface** — a readable, navigable web+API surface for every artifact the swarm generates and every decision a human needs to make on it.

## What & why

When the swarm runs `/hive:kickoff`, `/plan`, or `/execute`, it produces briefs, PRDs, architecture docs, plans, CBAs, and specs as `.md`/`.html` files on the box. **You cannot read those in a shell session.** The old workaround was pulling each doc off the box by hand and rendering it as a one-off Artifact.

Consus productizes exactly that. It is:

1. **A read/view surface** — render every generated doc cleanly, browse by repo / phase / epic.
2. **A decision surface** — approve · discuss · iterate · sign-off. An approval isn't "done" — it's *go-build*, and it becomes shared-truth KB.
3. **A Q&A / ideation loop** — surface the swarm's questions (kickoff/plan/CBA gates), answer them, iterate.

Consus exists as its own service (and its own repo, `mdostal/consus`) because the ideation→sign-off loop is a distinct capability slot in Pantheon: swappable, independently versioned, with its own store and its own human surface. It runs **standalone or as a Pantheon plugin** — every route serves both modes identically.

## Architecture

```mermaid
flowchart TB
  subgraph Consus["Consus (this repo)"]
    direction TB
    Web["Web SPA — Vite + React<br/>DecisionCard · DocRenderer · QAQueue<br/>KBBrowser · ProjectView (theme-aware)"]
    API["Fastify server :8722"]
    DB[("SQLite<br/>better-sqlite3<br/>items · audit_log · doc_index · kb_entries")]
    subgraph Adapters["Read/write adapters"]
      Doc["Doc Scanner"]
      Min["Minerva bridge<br/>(questions · surveys)"]
      Mul["Multica client<br/>(comments)"]
      Aur["Auriga reader<br/>(tracker state)"]
      Ves["Vesta policy"]
      Vot["Votem quorum router"]
    end
    Web -->|/api proxy| API
    API --> DB
    API --> Adapters
  end

  Doc -.scans .pHive/planning docs.-> Repos[("Pantheon repos<br/>generated .md/.html")]
  Min -.-> Minerva["Minerva (planning god)"]
  Mul -.-> Multica["Multica (board substrate)"]
  Aur -.-> Auriga["Auriga (routing god)"]
  Ves -.-> Vesta["Vesta (settings god)"]
  Vot -.-> Votum["Votum (quorum god)"]

  Human["Human reviewer"] -->|reads docs · decides| Web
```

Internally: a **Fastify** HTTP server (`server/index.ts`) on `:8722`, an idempotent **SQLite** schema (`server/db/migrate.ts`), a **doc scanner** that indexes generated docs, a `dostal:decision-request/v1` contract parser + classifier, a **KB store** with append-only audit log and versioning (so a decided item never loses its history), and a set of read/write **adapters** to sibling gods. The web layer is a Vite + React SPA whose feature components render docs via `marked` and present theme-aware decision cards.

## How it fits

Consus is one capability slot in **Pantheon** — the replace-yourself orchestration OS.

- **Core host:** [pantheon-v2](https://github.com/mdostal/pantheon-v2) owns the contracts; Consus plugs into it.
- **Substrate:** it reads planning docs and board state produced on top of [Multica](https://github.com/firefly-events/multica) and [plugin-hive](https://firefly-events.github.io/plugin-hive/).
- **Sibling gods it talks to:** **Minerva** (planning — supplies the questions and surveys Consus surfaces), **Multica** (the board — comment read/write), **Auriga** (routing — read-only tracker state), **Vesta** (settings — policy reader), and **Votum** (quorum voting). Consus is typically presented inside **Janus**, Pantheon's UI/portal god.

## Quickstart

```bash
npm install

# dev — web + server together (web proxies /api → :8722)
npm run dev

# or run them separately
npm run dev:server   # Fastify on :8722 (tsx watch)
npm run dev:web      # Vite dev server, proxies /api to :8722

# tests (Vitest — TDD backend / BDD UI)
npm test

# production build + start
npm run build        # → dist-web/ + dist-server/
npm start            # node dist-server/index.js on :8722  (or scripts/start.sh)
```

Config via env: `PORT` (default `8722`), `CONSUS_DB_PATH` (default `.pHive/consus.sqlite`), `CONSUS_PROJECTS_CONFIG` (repos to scan for docs, default `.pHive/consus-projects.json`).

Verify it's up:

```bash
curl localhost:8722/health          # { "status": "ok", "sqlite": "connected" }
curl localhost:8722/api/decisions   # open, undecided decision-request items
```

The full HTTP contract lives in [`docs/api-reference.md`](docs/api-reference.md) — a harness author can use Consus from that doc alone.

## Status

**WIP.** The server, HTTP API, SQLite store, doc scanner, decision contract, KB versioning, and the sibling-god adapters are **live and tested** (~109 passing tests across 31 suites). The React feature components (decision cards, doc renderer, Q&A queue, KB browser) are **built and tested but not yet assembled into the SPA shell** (`web/src/App.tsx` is still a placeholder), and doc rendering is markdown-only — **no mermaid yet**. See [VISION.md](VISION.md) for the current → goals → long-term trajectory and where to jump in.
