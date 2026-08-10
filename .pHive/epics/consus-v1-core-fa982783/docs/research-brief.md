# Research Brief: Consus v1 Core

**Epic:** consus-v1-core-fa982783  
**Date:** 2026-08-09  
**Researcher:** Planning orchestrator (lite mode)

## Executive Summary

This epic implements the two core flows that make Consus operational as the human-in-the-loop answer surface for the Pantheon's multi-agent harness:

1. **Minerva Question-Park → Consus Answer → Resume** — async clarification loop where blocking questions from planning agents are parked, answered in Consus UI, and resume the paused workflow
2. **Editable Docs → Fire Ticket** — doc-drives-build loop where living docs are edited in Consus and "firing" creates Multica tickets that the hive plugin picks up for execution

## Existing Infrastructure

### Confirmed (200 status verified)

- **`GET /api/docs`** (`server/routes/docs.ts`) — queries doc index, returns grouped docs by repo/phase
- **`GET /api/docs/content`** — reads actual markdown/HTML content from disk via doc-scanner adapter
- **`GET /api/decisions`** (`server/routes/decisions.ts`) — syncs Multica queue, lists open decision items
- **`POST /api/decisions/:key/iterate`** — posts iteration requests to Multica with agent mentions
- **`POST /api/decisions/:key/approve`** — writes approval comment + unblocks Multica issue + marks decided in SQLite
- **Multica adapter** (`server/adapters/multica/`)
  - `client.ts` — HTTP client with token resolution, issue CRUD, comment writes
  - `write-comment.ts` — comment posting with local cache
  - `ingest.ts` — sync Multica feed into local SQLite
- **Living docs composer** (`server/features/living-docs/compose.ts`) — merges docs + comments for a given item
- **SQLite schema** — items table with decision_payload, decided_at; comments table with multica_comment_id cache
- **Fastify server** — running on :8722
- **Vite web frontend** (`web/src/`) — React app

### Tech Stack

- **Backend:** TypeScript, Fastify, better-sqlite3
- **Frontend:** TypeScript, React, Vite
- **Integration:** Multica REST client (token via env or ~/.config/dostal/mtok)
- **Testing:** Vitest (unit), Playwright (e2e)

## Architecture Insights

### Current State

The existing Consus codebase is a **read-oriented decision UI** — it can:
- Display docs from .pHive/epics via doc-scanner
- Display Multica issues classified as decisions
- Post iterate/approve verdicts back to Multica
- Cache comments locally

### Gaps for v1 Core

1. **No parking/resume protocol** — Minerva has no API to park work + post questions, Consus has no endpoint to accept parked questions
2. **No doc editing** — docs are read-only; no PUT/PATCH endpoint to persist edits
3. **No "fire" action** — no button/API to create Multica ticket from edited doc content
4. **No question inbox UI** — decisions endpoint exists but no specific "questions from agents" view

## Key Patterns to Preserve

### Hive Plugin Ticket Mechanism

The requirement states both flows "leverage the EXISTING hive-plugin ticket mechanism (edit→fire→plan/build works well there)". Research shows:

- Multica is the shared task tracker
- Hive plugin already reads Multica issues and dispatches to agents
- The pattern: create Multica issue with rich context → hive worker picks it up → executes
- **Reuse this** — don't invent a new ticket format; write Multica issues with the doc/question as context

### Comment-Based Answers

The `/api/decisions/:key/iterate` endpoint shows the pattern:
- Question/prompt goes into Multica comment body
- Agent mention via `[@agent-name](mention://agent/id)`
- Comment ID cached in local SQLite for audit trail

**Apply this to question answers** — answer writes to Multica comment, triggers resume.

## Dependencies

### External
- Multica server (self-hosted) at configured URL
- Multica token resolution (MULTICA_TOKEN or ~/.config/dostal/mtok)
- .pHive directory structure in target repos

### Internal
- SQLite schema — may need new tables for parked questions
- Doc-scanner adapter — already scans .pHive/epics
- Multica client — already handles issue CRUD + comments

## Risks

1. **Resume protocol undefined** — how does Consus signal "answer ready" back to the paused Minerva workflow? Options:
   - Multica webhook (requires Multica server config)
   - Polling (Minerva checks issue status periodically)
   - Explicit resume API call from Consus → Minerva harness
   
2. **Doc persistence model** — editing a .pHive doc has two targets:
   - **Transient:** write to SQLite only, .pHive file unchanged (safer, no git noise)
   - **Committed:** write back to .pHive file on disk (matches "optionally commit to .pHive" requirement text)
   
   **Recommendation:** SQLite-first with optional commit-to-disk toggle.

3. **Concurrent edits** — requirement states "single-operator (Mathew) in v1 — no concurrency requirements". Can punt locking/CRDT to v2.

4. **Fire action scope** — does "fire" create:
   - One Multica issue for the whole doc?
   - One issue per section?
   - One issue with the diff since last fire?
   
   **Recommendation:** one issue per fire with full doc context in body; hive planner decides decomposition.

## Validation Notes

- No context7 validation needed — this is greenfield integration work, not library/SDK consumption
- Multica client contract already validated in prior epics (decisions endpoint is 200)
- Hive plugin worker contract is out-of-scope; assume it consumes Multica issues per existing pattern

## References

- `server/routes/docs.ts` — doc listing endpoint
- `server/routes/decisions.ts` — decision/iterate/approve flow (pattern to mirror for questions)
- `server/adapters/multica/client.ts` — Multica REST client
- `server/features/living-docs/compose.ts` — doc+comment composition
- `.pHive/project-profile.yaml` — north star: "Minerva's questions have no rendered home to be answered in"
