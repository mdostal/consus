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
| `CONSUS_HARNESS_COMMAND` | _(none)_ | The executable to invoke for the HarnessTransport. Without this, "Fire to harness" is a no-op. |
| `CONSUS_HARNESS_ARGS` | _(none)_ | Comma-separated list of arguments to pass to `CONSUS_HARNESS_COMMAND` |
| `CONSUS_DISCOVERY_ROOTS` | _(none)_ | Comma-separated list of absolute directory paths that `GET /api/projects/discover` should scan for candidate repos |

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

To enable the "Fire to harness" mechanism, set `CONSUS_HARNESS_COMMAND` to an executable that can receive a JSON payload over stdin and write a JSON response to stdout:

```bash
CONSUS_HARNESS_COMMAND=claude CONSUS_HARNESS_ARGS=--no-stream npm start
```

Or for the built-in Claude Code skill:

```bash
npm run agent:init   # installs skills/consus/SKILL.md → ~/.claude/skills/consus/
```

See [Harness Transport](agent-integration/harness-transport.md) for the full stdio protocol.

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
