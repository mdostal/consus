# Design Discussion — consus-phase25-project-registration-ux

## 0. Prelude

consus-phase-unplanned shipped `POST /api/projects` + a bare `AddProjectForm` as a one-off,
committed at `2c43718` on `main` as this epic's baseline. Testing it live surfaced three real gaps,
in the operator's own words:

1. "when i click a repo, it should give me the repo path" — selecting a project tells you nothing
   about where it lives on disk.
2. "the button added didnt map to the rest of the application" — the add-project form doesn't look
   like it belongs in Consus.
3. "we need to be able to easily find the other repos and browse — i don't know where the ... shit
   lives off of memory" — today you must already know and type the exact absolute path to a repo
   from memory. No discovery mechanism exists.

Explicit instruction: run this through `/plan` + `/execute` as a proper epic, not another one-off.

## 1. Goal

Make registering and navigating projects in Consus's Projects tab actually usable without the
operator needing to remember or type absolute filesystem paths from memory, and make the
registration UI look like it belongs in this application's existing visual system rather than a
bare unstyled form dropped on top of it.

## 2. What's already there vs. what's missing (read directly off the current codebase)

- **No API response ever includes a project's repo path**, except once, transiently, in
  `POST /api/projects`'s own 201 response at registration time (`server/routes/projects.ts:157`) —
  and the client (`App.tsx`'s `registerProject`) doesn't even store it. `GET /api/projects`
  (`server/routes/projects.ts:118-120`) returns bare `{ projects: string[] }`. There is no route
  today a selected-project view can call to learn where that project lives on disk.
- **Zero filesystem-discovery code exists anywhere in this codebase.** Grepped `server/` and
  `web/src/` for `readdir`/`scandir`/`opendir`/`glob(` — every hit walks a repo path Consus
  *already knows about* (doc-scanner, diagram-generator), never discovers unknown repo paths on
  disk. No "recently used paths," no OS file-picker integration, no candidate-repo listing.
  `AddProjectForm` is pure free-text entry (placeholder `/absolute/path/to/repo`), validated only
  server-side against `existsSync`/`statSync` after submission.
- **The add-project form is half-styled, not fully bare.** `AddProjectForm.tsx` and its CSS
  (`app.css:930-963`) already consume `--consus-*` design tokens for the field wrapper and text
  inputs. What's actually broken: the submit `<button type="submit">` has **zero** CSS rule
  anywhere targeting it (confirmed via grep) — it renders as a bare default browser button, next to
  inputs that otherwise look correct. Every other primary action in this app (`Fire to harness`,
  etc.) is styled via `.diagram-view__header button` (`app.css:1325-1335`): accent-filled,
  `border: 0`, bold, token-driven radius. The add-project button needs the equivalent treatment,
  not a redesign of the whole form.
- **The skin system is CSS-custom-property-driven, not per-skin component forks, for ordinary
  styling.** `[data-skin]`/`[data-theme]` on `<html>` retarget `--consus-*` tokens
  (`web/src/theme/tokens.css`); a component that only ever reads those tokens (as `.add-project-form`
  already mostly does) is automatically correct across all 3 skins × light/dark/system with zero
  skin-specific code. Per-skin **structural** forks exist only where content genuinely differs
  (`DiagramMetadataStrip.tsx`'s title-block/stamp/terminal-line — three different labels/layouts
  fed from one data source, dispatched via `useActiveSkin()`). Fixing the button is a pure-CSS,
  token-only fix — no per-skin fork needed. A repo-path display can follow the same plain-token
  path unless design wants title-block-style presentation (open question below).
- **The established dropdown convention is a plain native `<select>`**, not a custom
  combobox/autocomplete — see `BranchPicker.tsx:44-63` (label-wraps-select, populated via
  `useEffect` + `useState`, same fetch/loading/error shape every data-fetching component in this
  app already uses) and `ThemeSkinPicker.tsx`. No autocomplete/typeahead component exists anywhere
  in the repo. A repo-picker should follow this exact precedent unless the volume of candidate
  repos genuinely demands more (open question below).

## 3. Proposed approach

1. **Show the repo path for the selected project.** Extend `GET /api/projects`'s response to
   include each project's path (e.g. `{ projects: string[], paths: Record<string,string> }`) —
   the server already holds this in the in-memory `repos` map (`project-registry.ts`); this is a
   response-shape change, not new capability. **Update `docs/api-reference.md`'s documented
   response shape for this route as part of the same story** — that doc states its own contract is
   exact enough for "a harness author... from this doc alone," so the change isn't complete until
   the doc matches (grill finding H2). `ProjectsSection` (`App.tsx`) renders the selected project's
   path as a **labeled field** (e.g. `Repo path` label + value, matching the label-wraps-value
   pattern already used everywhere else in this app — `BranchPicker`, `ThemeSkinPicker`,
   `DiagramMetadataStrip`'s `Field` helper), token-styled — not bare unlabeled text next to the
   name. A stray line of plain text next to a project name would risk reading as exactly the kind
   of "doesn't look like it belongs" gap the operator already flagged for the add-project form
   (grill finding U1) — a labeled field reads as intentional the same way every other piece of
   metadata in this app does.

2. **Style the add-project submit button** to match `.diagram-view__header button`'s accent-filled
   convention — same tokens (`--consus-accent`, `--consus-bg`, `--consus-radius-scale`), same
   weight/padding logic, scoped under `.add-project-form button` so it doesn't leak into unrelated
   forms. Verify visually across all 3 skins × light/dark, per the operator's screenshot complaint —
   this is the actual root cause of "didn't map to the rest of the application," not a full form
   redesign (§2's finding: the rest of the form already tokenizes correctly).

3. **Three complementary ways to find a repo — resolved with the operator 2026-08-26, all three
   in scope (not a pick-one):**

   a. **Auto-surfaced sibling candidates.** Once at least one project is registered, its parent
      directory's other subdirectories that look like repos (`.git` and/or `.pHive` present) are
      free candidates with zero configuration — the exact case this session's own testing hit.

   b. **Explicit roots via `CONSUS_DISCOVERY_ROOTS`** — an optional env var (consistent with this
      codebase's existing env-driven config conventions — `CONSUS_PROJECTS_CONFIG`,
      `CONSUS_DB_PATH`, etc.) naming one or more directories whose immediate subdirectories are
      always offered as candidates, regardless of what's already registered.

   Both (a) and (b) are served by a single generic building block:
   **`GET /api/fs/list?path=<dir>`** — lists `path`'s immediate subdirectories, each flagged
   `isRepo: boolean` (`.git`/`.pHive` present). One level deep per call — a client that wants to
   go deeper calls it again with the chosen subdirectory as the new `path`, which is exactly what
   (c) below uses it for. **`GET /api/projects/discover`** is a thin convenience wrapper: resolves
   the (a)/(b) candidate roots, calls the same listing logic per root, filters to `isRepo &&
   not already registered`, and returns a flat `{ name, path }[]` for `AddProjectForm`'s
   auto-suggest `<select>` (matching `BranchPicker`'s established convention).

   c. **An interactive directory browser** — the operator's explicit ask, in their own words: "how
      the ... am i to memorize all of the paths on the computer." A new `DirectoryBrowser` client
      component (opened from an "Browse…" action in `AddProjectForm`) calls
      `GET /api/fs/list` repeatedly as the operator navigates: starts at a sensible default (e.g.
      the OS home directory, or the parent of the most-recently-registered project), shows the
      current directory's subdirectories as a list (repos visually flagged via the `isRepo` field),
      lets the operator click into any subdirectory to go deeper, keeps a breadcrumb trail back up,
      and has a "Select this directory" action that populates the path field with the current
      directory — whether or not it's flagged as a repo (an operator browsing to a not-yet-`git
      init`'d directory, or one Consus's heuristic misses, is still a legitimate choice; the
      heuristic is a visual hint, not a hard gate). This directly removes the "must already know
      the path" constraint (a)/(b) still have (both are bounded to one level below a *known* root)
      — (c) alone can reach any directory the operator can navigate to, at any depth.

   All three are additive on top of the existing free-text path input (never a hard requirement) —
   a repo outside any discoverable root, or one the operator already knows the path to, is still
   registerable by typing it directly.

   **Loopback-only by design** — both new server routes (`/api/fs/list`, `/api/projects/discover`)
   read local filesystem structure outside any project the operator has explicitly registered,
   which is a different exposure category than every other route in this app (grill finding P1);
   documented as intended for `HOST=127.0.0.1` (the default) and explicitly called out as
   unsuitable for a `HOST=0.0.0.0` containerized deploy, in `docs/api-reference.md` alongside both
   routes. `GET /api/fs/list` must reject/normalize `path` traversal outside a sane boundary (no
   `..`-walking above the resolved absolute path) and skip unreadable directories rather than
   erroring the whole listing.

## 4. Scale assessment

**Medium** — multi-file, cross-stack (a server response-shape change, two new server routes +
filesystem-listing logic, three client-facing pieces — labeled path field, styled button, directory
browser — CSS), no schema migration, no new external coupling. Per this epic's `hive.config.yaml`
(`planning.collaborative_review: true`, no `--gate-hv`), this routes to horizontal/vertical slice
planning, auto-proceeding to story decomposition without an additional user-facing H/V gate.

## 5. Open questions for the operator — resolved 2026-08-26

1. **Discovery root scope + scan depth (§3.3).** Resolved: all three mechanisms ship together, not
   a pick-one — auto-surfaced sibling candidates (a), explicit `CONSUS_DISCOVERY_ROOTS` (b), and an
   interactive directory browser (c) that can reach any depth the operator navigates to, removing
   the one-level-deep ceiling (a)/(b) have on their own. Operator's own words: "how the ... am i to
   memorize all of the paths on the computer" — (c) is the direct answer to that, (a)/(b) remain as
   zero-navigation shortcuts for the common case.

## 6. Risks

- **Discovery scan touching directories outside intended scope.** A misconfigured
  `CONSUS_DISCOVERY_ROOTS` (e.g. accidentally set to `/`) could make the scan slow or noisy.
  Mitigation: one-level-deep scan only (§3.3), and skip unreadable directories rather than erroring.
- **Path disclosure.** `GET /api/projects` returning absolute filesystem paths is new information
  exposed over HTTP. Consus already binds to `127.0.0.1` by default and this is local-machine
  metadata about repos the operator explicitly registered — same trust boundary as the existing
  `POST /api/projects` response already crossing this exact line once. Not a new category of risk,
  but worth being explicit about.
- **Discovery endpoint exposure in a containerized deploy.** Unlike path disclosure above (which is
  scoped to repos the operator explicitly registered), the discovery endpoint reads and returns
  filesystem structure the operator never opted into exposing. Mitigation: documented as a
  loopback-only feature in `docs/api-reference.md` (§3.3) — this is a documentation-level
  mitigation, not a code-level gate; revisit if Consus's containerized-deploy usage grows enough to
  warrant an explicit runtime check.
- **Documented API contract drift.** `docs/api-reference.md` states its own goal is letting "a
  harness author... use Consus from this doc alone." Both the `GET /api/projects` response-shape
  change and the new discovery route must land with that doc updated in the same story — treated as
  part of the story's definition of done, not a follow-up.
