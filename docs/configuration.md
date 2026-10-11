# Configuration

Consus is configured via environment variables and a JSON config file for registered projects.

---

## Environment variables

| Variable | Default | Description |
|---------|---------|-------------|
| `PORT` | `8722` | Port the Fastify server binds to |
| `HOST` | `127.0.0.1` | Interface the server binds to. Set `0.0.0.0` for a containerized deploy — `127.0.0.1` is unreachable from outside a container |
| `CONSUS_DB_PATH` | `.pHive/consus.sqlite` | Absolute or relative path to the SQLite database file. Created on first run. |
| `CONSUS_PROJECTS_CONFIG` | `.pHive/consus-projects.json` | Path to the JSON file mapping project names to repo paths |
| `CONSUS_ATTACHMENTS_DIR` | `.pHive/attachments` | Where uploaded item attachments are stored |
| `CONSUS_DISCOVERY_ROOTS` | _(none)_ | Comma-separated list of absolute directory paths that `GET /api/projects/discover` should scan for candidate repos |
| `CONSUS_HARNESS` | _(none)_ | Set to `webhook` to select the generic webhook transport (requires `CONSUS_HARNESS_WEBHOOK_URL`). `pantheon` was removed (PANT-969) and now fails at startup. See [Harness wiring](#harness-wiring). |
| `CONSUS_HARNESS_WEBHOOK_URL` | _(none)_ | Where `CONSUS_HARNESS=webhook` POSTs each proposal. Required in webhook mode. |
| `PANTHEON_API_URL` | _(none)_ | Base URL of Pantheon core-api. Enables the outbound Pantheon pushes (question answers, the verdict bridge, `decision:needs-context`) and the tenant-path check below; `/health` and `GET /api/metrics` then report their sync status. Not a transport. |
| `REPOS_BASE_DIR` | `/repos` | Tenant repo mount root. When `PANTHEON_API_URL` is set, ingesting a project whose path looks like `<REPOS_BASE_DIR>/<tenant>/<repo>` first validates it against Pantheon's repo facade. |
| `CONSUS_HARNESS_FILE_DIR` | _(none)_ | Selects the file transport: each proposal is written as `<dir>/<proposalId>.json` |
| `CONSUS_HARNESS_COMMAND` | _(none)_ | Selects the stdio transport: the executable to spawn per proposal |
| `CONSUS_HARNESS_ARGS` | _(none)_ | Comma-separated list of arguments to pass to `CONSUS_HARNESS_COMMAND` |
| `CONSUS_THREAD_WEBHOOK_URL` | _(none)_ | Where agent-thread messages are POSTed (one `consus.thread.message` event per operator message). Unset: they go through the harness transport instead. See [Agent threads](#agent-threads). Startup fails if set to an invalid URL. |
| `CONSUS_PUBLIC_URL` | _(request host)_ | Base URL Consus is reachable at, used for the `replyUrl` in outbound thread events. Set it when the agent reaches Consus at a different address than the browser does (container, proxy). |

With no harness transport selected, "Fire to harness" records every proposal as `failed` immediately.

The handoff CLI (`bin/handoff.mjs`) reads its own env: `CONSUS_HANDOFF_DIR` (default `.pHive/handoffs`), `CONSUS_URL` (default `http://localhost:${PORT}`), `PORT`, and `CONSUS_AGENT_NAME` (author of `reply`, default `agent`).

### HOST binding

!!! warning "Container deploys"
    If you run Consus inside a container and need to reach it from the host or another container, set `HOST=0.0.0.0`. The default `127.0.0.1` is unreachable from outside the container network.

    `HOST=0.0.0.0` removes the loopback protection. Add your own auth or network controls in front if the port is reachable from untrusted networks.

---

## Projects config file

`CONSUS_PROJECTS_CONFIG` (default `.pHive/consus-projects.json`) maps project names to absolute repo paths:

```json
{
  "consus": "/Users/you/repos/consus",
  "my-other-repo": "/Users/you/repos/my-other-repo"
}
```

This file is written automatically when you register a project via `POST /api/projects` or the UI — you don't need to edit it by hand. It persists across restarts.

If the file doesn't exist, Consus defaults to `{ "consus": <cwd> }` — the current working directory registered as a project named `consus`.

---

## Harness wiring

Consus picks one transport at startup; the first match in this order wins:

1. `CONSUS_HARNESS=webhook` + `CONSUS_HARNESS_WEBHOOK_URL` — **webhook.** Each proposal is POSTed to the URL as `{ "method": "proposeChange", "params": { … } }`, the same JSON the stdio transport writes (payload contract in `docs/api-reference.md#proposal-payload-contract`). The receiver reports results through `POST /api/proposals/:id/result`. A non-2xx, timeout, or network error marks the proposal `failed` with a `delivery_error`; there is one attempt and no retry loop, so retry by hand with `POST /api/proposals/:id/redeliver` or the **Retry delivery** button in the history panel. Startup fails if the URL is missing or invalid. To run under Pantheon, point it at core-api: `CONSUS_HARNESS_WEBHOOK_URL=<core-api>/api/feed/changes/webhook?origin=consus`.
2. `CONSUS_HARNESS_FILE_DIR=<dir>` — **file** (standalone). Proposals are written as JSON files; a harness lists them and reports results with `node bin/handoff.mjs list` / `node bin/handoff.mjs result <proposalId> applied|failed [reason]`. Point `CONSUS_HANDOFF_DIR` at the same directory.
3. `CONSUS_HARNESS_COMMAND=<cmd>` — **stdio**, described next.
4. none of the above — **NOOP**.

`CONSUS_HARNESS=pantheon` and its pollers (`CONSUS_PANTHEON_POLL`, `CONSUS_PANTHEON_RESULT_POLL`) were removed (PANT-969). Consus never polls: Pantheon pushes question tickets in through `POST /api/questions/import` / `POST /api/questions/:ticket/close` and change results through `POST /api/proposals/:id/result`.

For the stdio transport, set `CONSUS_HARNESS_COMMAND` to an executable that can receive a JSON payload over stdin and write a JSON response to stdout:

```bash
CONSUS_HARNESS_COMMAND=claude CONSUS_HARNESS_ARGS=--no-stream npm start
```

Or for the built-in Claude Code skill:

```bash
npm run agent:init   # installs skills/consus/SKILL.md → ~/.claude/skills/consus/
```

See [Harness Transport](agent-integration/harness-transport.md) for the full stdio protocol, and the "Harness transports" section of `docs/api-reference.md` for the HTTP calls each transport makes.

---

## Agent threads

Comment threads on docs, sections, diagrams, decisions and proposals can be answered by an outside agent ([contract](agent-integration/threads.md)). Each operator message goes out once:

1. `CONSUS_THREAD_WEBHOOK_URL` set — POSTed there as the bare event JSON.
2. otherwise — handed to the harness transport above as a `threadMessage` call. The file transport writes `<CONSUS_HARNESS_FILE_DIR>/threads/<threadId>.<messageId>.json` (answer with `node bin/handoff.mjs threads` / `reply`); stdio and `CONSUS_HARNESS=webhook` send `{ "method": "threadMessage", "params": <event> }`. Under Pantheon, set `CONSUS_THREAD_WEBHOOK_URL` to core-api's thread endpoint: its proposal webhook rejects `threadMessage`.

With neither, the message is stored and marked "not delivered: no agent configured". A failed delivery is retried only by hand (**Retry** in the thread, or `POST /api/threads/:id/redeliver`).

---

## hive.config.yaml

The `hive.config.yaml` in the repo root is a Consus-specific config for the Pantheon/Hive build system — it is not read by the Consus server itself. It describes how Consus is wired into the broader Pantheon toolchain and is not relevant for standalone use.

---

## Example: .env file

```bash
PORT=8722
HOST=127.0.0.1
CONSUS_DB_PATH=/Users/you/.local/share/consus/consus.sqlite
CONSUS_PROJECTS_CONFIG=/Users/you/.config/consus/projects.json
CONSUS_HARNESS_COMMAND=node
CONSUS_HARNESS_ARGS=/Users/you/.claude/skills/consus/harness.js
```

Load with `dotenv` or your preferred env-file loader — Consus reads from `process.env` directly; no built-in dotenv loading.
