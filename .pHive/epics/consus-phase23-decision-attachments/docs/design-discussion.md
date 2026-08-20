# Design Discussion — consus-phase23-decision-attachments

## 0. Prelude

Surfaced by a `/plugin-hive:grill` adversarial pass run during the v0.11.0 OSS-release-readiness
work: 15 stale `feat/PAN-####`/`archive/*` branches on `origin` were mined for genuinely valuable,
standalone-compatible functionality before being deleted (see
`consus-phase22-oss-release-readiness`'s deletion cleanup). Of 15 branches, 14 were either
already-merged or obsolete Multica/Minerva-coupling work. One survived: a complete file-attachment
capability on `origin/feat/PAN-7819`, built during the pre-strip era but never merged before the
coupling strip landed.

## 1. Goal

Let a human attach files (screenshots, PDFs, exported docs) to a decision item in Consus, so
context that doesn't fit in markdown — a screenshot of a bug, a signed-off PDF spec — lives next
to the decision it informs, not in a separate chat thread or email.

## 2. What exists to port (read directly off `origin/feat/PAN-7819`, not guessed)

- `server/storage/adapter.ts` — a `StorageAdapter` interface (`upload`/`download`/`delete`).
- `server/storage/filesystem.ts` — `FilesystemStorage`, a working local-disk implementation.
- `server/storage/s3.ts` + `server/storage/index.ts` — an `S3Storage` stub/factory. **Not ported
  in this epic** — Consus is a standalone, local-first tool; a cloud storage backend is out of
  scope until an actual deployment need for it exists. `createStorageAdapter()`'s factory shape is
  worth keeping (so a future S3 adapter can slot back in), but it will construct only
  `FilesystemStorage` for now.
- `server/routes/attachments.ts` — `POST/GET/DELETE` handlers, file-type allowlist, 10MB limit,
  an `attachments` table.
- `web/src/components/AttachmentUpload.tsx`, `useFileUpload.ts`, `AttachmentList.tsx`,
  `AttachmentItem.tsx` — drag-drop upload with progress, list with previews, delete confirm.
- Test coverage: `server/routes/attachments.test.ts`, component tests, and
  `tests/e2e/attachment-{upload,download}.spec.ts` (Playwright — note: this repo has no Playwright
  e2e harness wired up today; the e2e specs are useful reference for behavior but won't run as-is
  — see Risks).

## 3. What must change — this is a port, not a copy-paste

1. **Route naming.** The old branch used `/api/tickets/:id/attachments` (a Multica-era "ticket"
   framing). Every other Consus route addressing an item uses `/api/items/:id/...`
   (`/api/items/:id/comments`, `/api/items/:id/decide`, `/api/items/:id/audit-trail` —
   see `docs/api-reference.md`). This port uses `/api/items/:id/attachments` for consistency.

2. **`items` table FK is still valid.** Confirmed against `server/db/migrate.ts`'s current schema
   — `items(id TEXT PRIMARY KEY, ...)` is unchanged in shape since the old branch was written.
   `attachments.item_id TEXT NOT NULL REFERENCES items(id)` ports as-is.

3. **Migration style.** The old branch's migration approach is unknown/unverified (not read — out
   of scope to reconcile). This port adds the `attachments` table as a new `CREATE TABLE IF NOT
   EXISTS` block inside `server/db/migrate.ts::runMigration`, matching the exact idempotent
   convention every other table in that file already follows (see the `proposals`/`events` tables
   for the current house style, including the precedent comment style used for a prior
   PAN-branch port: `kb_entries.collection`, "Ported from ... (feat/PAN-6478), re-derived against
   this build's current schema rather than cherry-picked").

4. **`uploaded_by` was a hardcoded placeholder** (`"authenticated_user"`). Consus has no auth
   layer (standalone, local-first). Follow the existing convention `POST /api/items/:id/decide`
   already uses: accept an `actor` field from the caller (form field on the multipart upload,
   required) instead of a hardcoded string — consistent with how the rest of Consus's write paths
   already handle "who did this" without a real auth system.

5. **Storage default location.** The old branch defaulted to `<cwd>/data/attachments`. Consus's
   existing convention (`CONSUS_DB_PATH` defaulting to `.pHive/consus.sqlite`,
   `CONSUS_PROJECTS_CONFIG` defaulting to `.pHive/consus-projects.json`) keeps local state under
   `.pHive/`. This port defaults to `.pHive/attachments/`, overridable via a new
   `CONSUS_ATTACHMENTS_DIR` env var, matching the existing env-var naming pattern exactly.

6. **New dependency.** `@fastify/multipart` is not currently a dependency (confirmed via
   `package.json`) and must be added — it's what the old branch's route handler used for
   multipart file uploads and is the standard Fastify-ecosystem choice (already using
   `@fastify/static`, so staying in the `@fastify/*` family is consistent).

7. **UI wiring target has moved.** The old branch's UI wired into a `DecisionDetailPanel` that no
   longer exists — dev's decisions feature was independently renamed/restructured post-strip into
   `DecisionListPane`/`DecisionCard` (`web/src/features/decisions/`). This port wires the ported
   `AttachmentList`/`AttachmentUpload` components into `DecisionCard.tsx`'s expanded/detail state
   (read that file first — don't assume its current shape from the old branch's assumptions).

8. **No Playwright e2e harness exists in this repo today.** The old branch's e2e specs are useful
   as behavioral reference (what "upload then download round-trips correctly" should look like)
   but this epic does not stand up a new e2e test runner just to run them — vitest + Testing
   Library coverage (matching every other feature in this codebase) is the bar, consistent with
   how the rest of Consus is tested.

## 4. Scale assessment

**Medium** — multi-file, two layers (server + web), but well-scoped and the shape of the change is
already known (it's a port, not a from-scratch design). No H/V planning needed; two vertical
stories (server capability, then UI wiring) each leave the product in a working state.

## 5. Risks

- **`File`/`Blob` Node globals.** The old branch's `FilesystemStorage.upload()` and
  `attachments.ts` route handler use the Web-standard `File`/`Blob` types as if they were Node
  globals. These are available as Node globals since Node 20 (`node --version` on this machine
  needs confirming during implementation — the story's research step must verify Consus's actual
  minimum supported Node version, e.g. any `engines` field or CI's `node-version`, before assuming
  this compiles/runs cleanly under `tsc`'s configured `lib`/`target`).
- **File-type allowlist is extension-based, not content-sniffed.** The old branch checks
  `path.extname()` only, with a comment `// For MIME sniffing placeholder / naive validation`
  acknowledging this. This port keeps the same extension-based approach for v1 (matching the old
  branch's own documented scope), but does not claim to be doing real content-based MIME
  validation — worth a one-line doc note so nobody assumes otherwise later.
- **Soft-delete with no cleanup job.** `DELETE` sets `deleted_at` but never removes the underlying
  file from disk (the old branch's own comment: "cleanup job removes"). This port keeps the
  soft-delete row semantics (so `GET` correctly 404s on a deleted attachment) but does not build a
  cleanup job — out of scope, and worth flagging in the story as a known, accepted gap rather than
  a silent one.

## 6. Open questions

1. Should `GET /api/items/:id/attachments` (list) exist? The old branch only had per-attachment
   `GET /api/attachments/:id` (download) — nothing to list all attachments for an item. The UI
   needs a list, so either the item's existing `GET /api/decisions` response gains an
   `attachments: [...]` summary array, or a new `GET /api/items/:id/attachments` listing route is
   added. **Resolved for this plan:** add `GET /api/items/:id/attachments` as its own listing
   route, consistent with how comments (`GET /api/items/:id/comments`) already work as a sibling
   per-item collection route — don't overload the decisions response shape.
