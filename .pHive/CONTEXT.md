# Project CONTEXT

Delphi is the Pantheon's rendered doc/decision surface — see `docs/north-star.md` and
`docs/prior-art.md`.

## Terminology

- **item** — the base unit in the KB store (`items` table): any doc, decision, CBA, or
  KB entry Delphi tracks. Optionally carries a `decision_payload`.

## Key paths

- `server/` — Fastify backend: HTTP API, WebSocket gateway, adapters, KB store.
- `server/db/connection.ts` — opens/creates the SQLite file at `DELPHI_DB_PATH`.
- `server/db/migrate.ts` — idempotent schema migration, safe to run on every boot.
- `web/` — React + Vite SPA.
- `.pHive/delphi.sqlite` (dev) — the local SQLite KB store file (gitignored).

## Conventions

- Migrations are additive and idempotent (`CREATE TABLE IF NOT EXISTS`) — never a
  destructive rewrite. See `server/db/migrate.ts`.

## Canonical references

- `.pHive/planning/architecture.md` — tech stack and component map.
- `docs/prior-art.md` — the prior `/delphi` implementation this build reconciles against.
