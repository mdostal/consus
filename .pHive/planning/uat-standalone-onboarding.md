# UAT — Standalone Consus: Strip + Onboarding/Ingest

**Scope:** `consus-phase6-standalone-onboarding` (commits `006eaa3` → `213c119`), on top of the
Multica/Minerva/Auriga/Vesta/Votem strip (`4653222`). This is the acceptance pass for both —
the strip made Consus stop depending on anything outside itself; this epic made it able to
bootstrap itself from nothing.

**How to use this doc:** open it in Consus (Docs tab, or the per-project view once you've
ingested — this file lives under `.pHive/planning/`, so it's part of what ingest picks up).
Check items off as you verify them by editing the boxes below (`- [ ]` → `- [x]`) and saving —
Consus reads doc content live off disk on every open, so re-opening the doc here shows your
checked-off state immediately, no re-ingest needed.

Run `npm run dev` first if the app isn't already up — web on `http://127.0.0.1:5173`, server on
`http://127.0.0.1:8722` (proxied under `/api`). Both bind to `127.0.0.1` only.

---

## Shipped diagram snapshot — consus-phase6-standalone-onboarding

Pulled live from `GET /api/diagrams?repo=consus` — this is exactly what the Projects tab
renders for this epic.

```
consus-phase6-standalone-onboarding — Standalone onboarding + on-demand repo ingest
  s1-repo-ingest-endpoint       [low]     deps: (none)
  s2-project-overview-with-docs [medium]  deps: s1-repo-ingest-endpoint
  s3-first-run-onboarding-screen[medium]  deps: s1-repo-ingest-endpoint
```

**Note on the rest of the cascade:** the same endpoint also returns four older epics —
`consus-v1-core-loop`, `consus-phase2-survey-kb-api`, `consus-phase4-close-the-loop`,
`consus-phase5-live-and-interactive` — and several of those still name Minerva/Multica/
Auriga/Vesta/Votem in their story titles (e.g. `minerva-adapter-bridge`,
`multica-client-comment-write`). **That's expected, not a regression.** Those are the
historical planning record of what was actually built and shipped at the time — the strip
removed the *live code coupling*, not the git/planning history, per the explicit "leave the
history, strip it all out and move forward" call. If any of those names show up in *running
behavior* (a network call, a UI tab, a server log) rather than *diagram/doc text*, that's a
real regression — see checklist item B4.

---

## A. Standalone / no external coupling

- [x] A1. `grep -rln "multica\|minerva" server web/src --include="*.ts" --include="*.tsx"` (from repo root) returns only comment/test-fixture prose (decision-contract parser test fixtures, historical doc text) — no live imports, no adapter code, no client classes. _(Verified live 2026-08-13: only `parser.test.ts` fixtures, `transport.ts`'s own "no Minerva, no Multica" doc comment, and a `DocRenderer.test.tsx` fixture string — no live code.)_
- [x] A2. `server/adapters/` contains only `doc-scanner/` — no `multica/`, `minerva/`, `auriga/`, `vesta/`, `votem/` directories. _(Verified.)_
- [x] A3. Server boots with zero external env vars set (no `MULTICA_*`, no `MINERVA_*`) and `/health` returns `{"status":"ok","sqlite":"connected"}`. _(Verified — dev server running now with no external env vars.)_
- [x] A4. `archive/pantheon-coupled-consus` branch still exists on `origin` (the old coupled work is preserved, not deleted). _(Verified — present both locally and on `origin`.)_

## B. Local-only

- [x] B1. `vite.config.ts` binds `host: "127.0.0.1"` (not `true`, not a tailnet hostname). _(Verified by reading the file.)_
- [x] B2. `server/index.ts`'s `app.listen` binds `host: "127.0.0.1"`. _(Verified by reading the file.)_
- [ ] B3. The app is reachable at `http://127.0.0.1:5173` and **not** reachable from another device on the network/tailnet. _(Local reachability confirmed via live browser session tonight; not-reachable-from-another-device needs a second device to actually test — leave for your pass.)_
- [ ] B4. Watch the Network tab in devtools while clicking through the whole app once — every request goes to `127.0.0.1:8722`, nothing external. _(Only spot-checked Projects tab so far — do a full click-through.)_

## C. Ingest flow (the core of this epic)

- [x] C1. Fresh DB (or a project with nothing ingested yet): `GET /api/docs` returns `{"consus":{}}` before any ingest. _(Verified via a clean throwaway DB earlier tonight.)_
- [x] C2. `POST /api/projects/consus/ingest` returns `{"project":"consus","docsScanned":<N>}` with `N > 0`. _(Verified live — 11 then 12 docs scanned as this doc itself was added.)_
- [x] C3. Calling ingest a second time in a row does not duplicate `doc_index` rows and still reports the correct count (idempotent). _(Covered by s1's automated test + confirmed the count only grew by exactly the one new file added between calls.)_
- [x] C4. `POST /api/projects/does-not-exist/ingest` returns `404` with `{"error":"unknown project: does-not-exist"}`. _(Verified via a clean throwaway DB earlier tonight.)_
- [x] C5. After ingest, `GET /api/docs` shows real entries — `architecture.md`, `prd.md`, `product-brief.md`, etc. under `.pHive/planning`. _(Verified live — this exact file showed up in the list after ingest.)_

## D. Per-project view (diagrams + docs + KB together)

- [x] D1. `GET /api/projects` returns `{"projects":["consus"]}` **even with zero KB entries** — this was the bug found and fixed in `213c119`; confirm it stays fixed. _(Verified live.)_
- [x] D2. In the Projects tab, "consus" is selectable as a project even before anything has been approved into the KB. _(Verified live via browser — clicked straight through to the project view.)_
- [x] D3. Selecting "consus" shows the diagram cascade and the docs list together in one view. _(Verified live via screenshot. Note: this dev DB's existing KB entries are all tagged `unassigned`, not `consus`, so the KB-entries-present case of "together" wasn't exercised by this click-through — the empty-KB case was.)_
- [ ] D4. With no docs ingested yet, the docs block in the per-project view shows an enabled "Ingest repo" button. _(Covered by s2's automated tests; not re-verified live tonight since this dev DB already has docs ingested — the button is visible regardless of state, per the screenshot, but the specific empty-precondition wasn't re-exercised live.)_
- [ ] D5. Clicking "Ingest repo" from the per-project view populates the docs list in place, with a loading state while it runs — no full page reload. _(Not click-tested live tonight — do this one.)_
- [ ] D6. Killing the server mid-request (or hitting a bad project name) surfaces a visible error in that view — it doesn't fail silently.
- [x] D7. Opening a doc from the per-project docs list (this UAT doc itself) renders it as formatted markdown, not raw text. _(Verified live — see the screenshot; headings, bold, checklists, code spans all rendered correctly.)_

## E. First-run onboarding screen

- [ ] E1. On a totally fresh install (empty `doc_index`, empty `kb_entries`, zero decisions), the app shows the onboarding screen instead of the normal Decisions/Projects/KB/Docs tab shell.
- [ ] E2. The onboarding screen shows an "Ingest repo to create initial knowledge base" call to action.
- [ ] E3. The onboarding screen shows an "Install into harness" section pointing at `skills/consus/SKILL.md`.
- [ ] E4. The onboarding screen shows "Interact with plugin-hive" copy (this is intentionally non-functional placeholder copy for now — confirm it reads as forward-looking, not as a broken button).
- [ ] E5. Clicking the onboarding ingest CTA transitions straight into the normal tab shell on success, no manual refresh needed.
- [ ] E6. Once anything exists (docs, a KB entry, or a decision), reloading the app goes straight to the normal tab shell — onboarding never reappears.

## F. Regression — existing surfaces still work

- [ ] F1. Decisions tab still loads and behaves (open/decided split, accept/verdict flow) — this used to sync from Multica and no longer does; confirm it's just quiet (no crash, no error banner) rather than broken.
- [ ] F2. KB tab (backlog search + collections) still works.
- [ ] F3. The global (unscoped) Docs tab still works alongside the new per-project docs block — both should work, this epic was additive.
- [ ] F4. No console errors on any tab, including the one that used to crash on a null `decision_payload` (fixed pre-strip, in `dd27e02` — worth a re-check since it's adjacent code).

## G. Automated checks (already green as of `213c119` — spot-check, don't have to redo from scratch)

- [x] G1. `npx vitest run` — 178/178 passing. _(Confirmed tonight.)_
- [x] G2. `npx tsc -p server/tsconfig.json --noEmit` — clean. _(Confirmed tonight.)_
- [x] G3. `npx vite build` — clean. _(Confirmed tonight.)_

---

## Sign-off

- [ ] All sections above reviewed.
- [ ] Blocking issues found: _(list here, or "none")_
- [ ] Accepted by: _______________  Date: _______________
