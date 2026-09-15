# Installation

## Prerequisites

- **Node.js** 20 or later (LTS recommended)
- **npm** (comes with Node)
- A repo with a `.pHive/` planning tree to index (or just the Consus repo itself)

## Install

```bash
git clone https://github.com/mdostal/consus.git
cd consus
npm install
```

## Run

```bash
# Development — web + server together (hot reload)
npm run dev

# Or run them separately
npm run dev:server   # Fastify on :8722 (tsx watch)
npm run dev:web      # Vite dev server, proxies /api to :8722
```

## Verify

```bash
curl localhost:8722/health
# → { "status": "ok", "sqlite": "connected" }

curl localhost:8722/api/decisions
# → open, undecided decision-request items (empty array if none yet)
```

If you see `{ "status": "ok" }` the server is running and the SQLite connection is healthy.

## Production build

```bash
npm run build        # → dist-web/ + dist-server/
npm start            # node dist-server/index.js on :8722
```

The production server serves the built web SPA (`dist-web/`) itself via `@fastify/static` — no separate web server needed.

## Wire up the agent harness

```bash
npm run agent:init   # installs skills/consus/SKILL.md into ~/.claude/skills/consus/
npm run agent:status # check whether it's installed and current
```

This makes any Claude Code session on your machine able to read and act on this repo's decision queue, regardless of which repo that session is currently open in. See [Agent Integration](../agent-integration/skill.md) for the full harness contract.

## Next step

[Register a project and take the core loop for a first run →](first-project.md)
