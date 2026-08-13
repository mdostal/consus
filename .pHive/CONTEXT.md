# Project CONTEXT

Consus is the Pantheon's rendered doc/decision surface — see `docs/north-star.md` and
`docs/prior-art.md`.

## Terminology

- **item** — the base unit in the KB store (`items` table): any doc, decision, CBA, or
  KB entry Consus tracks. Optionally carries a `decision_payload`.

## Key paths

- `server/` — Fastify backend: HTTP API, WebSocket gateway, adapters, KB store.
- `server/db/connection.ts` — opens/creates the SQLite file at `CONSUS_DB_PATH`.
- `server/db/migrate.ts` — idempotent schema migration, safe to run on every boot.
- `web/` — React + Vite SPA.
- `.pHive/consus.sqlite` (dev) — the local SQLite KB store file (gitignored).
- `.pHive/imports/multica-archive/` — preserved historical decision/KB data
  (45 + 12 entries) pulled from the old hive-hosted Claud-ometer surface
  before it went fully offline; see its README.md for provenance/checksums.
  Consumed by story `s2-historical-backfill-importer`.

## Conventions

- Migrations are additive and idempotent (`CREATE TABLE IF NOT EXISTS`) — never a
  destructive rewrite. See `server/db/migrate.ts`.

## Canonical references

- `.pHive/planning/architecture.md` — tech stack and component map.
- `docs/prior-art.md` — the prior implementation (Consus was named "Delphi," routed at `/delphi`, during early planning) this build reconciles against.
