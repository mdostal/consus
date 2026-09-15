# Consus

**The architect tool for any repo.**

A local knowledgebase, graph, and doc editor for your repo's decisions, docs, and architecture — with an agent-facing HTTP API so any harness can read and write to it.

[Get started](getting-started/installation.md){ .md-button .md-button--primary } [GitHub](https://github.com/mdostal/consus){ .md-button }

---

## What it does

A repo accumulates decisions, briefs, PRDs, architecture docs, and plans as files on disk. Reading those cleanly, or tracking which decisions are still open, is tedious. Consus indexes a repo's own `.pHive/` planning tree and gives it a real interactive surface — without coupling to any external system.

**The core loop: index → open → interact → propose**

| Step | What happens |
|------|-------------|
| **Index** | Scan a repo's `.pHive/planning/` tree on demand — populates a local SQLite doc index |
| **Open** | A per-project view shows diagrams, docs, and KB entries together |
| **Interact** | Read and edit docs in place; drag, relabel, and rewire diagrams on a live canvas |
| **Propose** | "Fire to harness" sends a `{diff, description}` to whatever local harness is configured |

The core loop closes with a **shared-truth KB** — approved decisions and docs become durable, versioned `kb_entries` rows, grouped by collection.

---

## Key properties

- **Fully standalone.** Zero live coupling to any external system. Reads and writes only local SQLite and the local filesystem.
- **Local-only by default.** Binds to `127.0.0.1:8722` — no network exposure unless you opt in via `HOST`.
- **Agent-ready.** Any harness that understands `skills/consus/SKILL.md` can drive it over plain HTTP.
- **Visual system built in.** Four switchable skins (Granary, Drafting Table, Case Board, Harness) × light/dark/system theme. A `⌘K` command palette covers the keyboard-shortcut floor.

---

## Quick links

- [Installation](getting-started/installation.md) — prerequisites, install, run, verify
- [API Reference](api/index.md) — full HTTP contract; a harness author can use Consus from this doc alone
- [Agent Integration: Claude Code Skill](agent-integration/skill.md) — wire up a Claude Code session in one command
- [Configuration](configuration.md) — environment variables and config files
- [Architecture](concepts/architecture.md) — Fastify · SQLite · Vite + React · zero external coupling
