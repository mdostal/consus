# Design discussion: multi-repo live-git doc resolution

## Goal

`.pHive/planning/roadmap.md` tracks this as REQ-20 ("Multi-Repo Live-Git Doc
Resolution"): port `mdostal/delphi`'s `server/gitdocs.mjs` pattern so Consus
can resolve and read a doc reference that lives in a *different* repo than
the one currently being viewed — and optionally at a specific git ref rather
than only the current working tree. `.pHive/planning/backlog.md` carries the
same item as `backlogged`.

## Confirmed still missing

Grepped `server/**/*.ts` for `gitdocs`, `extractDocCandidates`,
`resolveInRepos`, `readGitDoc`, and `multi-repo` — no matches. Read
`server/adapters/doc-scanner/index.ts` and `server/routes/docs.ts` directly:

- `doc-scanner/index.ts`'s `scanRepo()` walks exactly one repo's
  `.pHive/planning/` and `.pHive/epics/**` (`SCAN_ROOTS`, hardcoded), keyed
  by a single `repoPath` passed in per call.
- `readDocContent(repoPath, relFilePath)` does a plain `readFileSync(join(repoPath,
  relFilePath))` — working-tree only, no ref parameter, no cross-repo search.
- `routes/docs.ts`'s `GET /api/docs/content?repo=&path=` requires the caller
  to already know which configured `repo` name holds the doc; there is no
  "which repo has this path" resolution step, and no ref-aware read.

So this is a real, unbuilt gap — not already-shipped work. This epic plans
mainline work for it (in contrast to some other backlog items this same
session, which turned out already built).

## What the reference implementation actually does

`docs/delphi-lineage-inventory.md`, Source 2, describes `mdostal/delphi`'s
`server/gitdocs.mjs` as a complete, working pipeline with three parts:

1. **`extractDocCandidates(text)`** — regex-pulls doc-path-like references
   (e.g. `docs/foo.md`) out of arbitrary source text (a ticket body, a
   planning doc), filtering noise like bare `README.md`/`CLAUDE.md`
   mentions that aren't really cross-repo pointers.
2. **`resolveInRepos(candidate)`** — scans every repo under a configured
   `CODE_ROOT` (e.g. `~/Documents/work/dostal/code/`) for a matching path,
   returning which repo actually has it.
3. **`readGitDoc(path, ref)`** — reads the file's content, ref-aware: `git
   show ref:path` when a specific commit/branch/tag is given, otherwise the
   working-tree file. A `currentBranch()` helper accompanies it.

The problem this solves: today a planning doc or ticket in one repo can
reference a path that actually lives in a sibling repo (or at a specific
historical ref), and there's no way for Consus to find or read it — only the
one repo currently being viewed is reachable.

## Approach for mainline

Consus does not have a `CODE_ROOT`-scanned filesystem tree — it has
`server/config/project-registry.ts`'s `ProjectRegistry` (`Record<string,
string>`, project name -> absolute repo path), already loaded by
`loadProjectRegistry()` and passed into every route module as `repos` (see
`server/index.ts`'s `buildServer()`, which threads the same `repos` object
into `registerDocRoutes`, `registerProjectRoutes`, and
`registerDiagramRoutes`). This is the natural, already-existing "list of repo
roots" input for `resolveInRepos` — no new registry concept is needed, and
using it means resolution is automatically scoped to only repos an operator
has deliberately configured (see Risks).

Planned shape, ported as a new adapter module rather than folded into
`doc-scanner`:

- **New module `server/adapters/gitdocs/index.ts`** (named after the
  reference file, for direct traceability), exporting:
  - `extractDocCandidates(text: string): string[]` — pure function, same
    regex-extraction/noise-filtering behavior as the reference.
  - `resolveInRepos(candidate: string, repos: ProjectRegistry): { repo: string; path: string } | null`
    — tries `candidate` against each configured repo root (`existsSync(join(repoRoot,
    candidate))`), first match wins; returns `null` if no configured repo has
    it. Every join is resolved and checked to stay under its repo root before
    the filesystem check (see security constraint below).
  - `readGitDoc(repoPath: string, relPath: string, ref?: string): { content: string; format: "md" | "html" }`
    — when `ref` is given, shells out to `git show ${ref}:${relPath}` (via
    `execFileSync("git", ["show", \`${ref}:${relPath}\`], { cwd: repoPath })`
    — argument-array form, never a concatenated shell string, so a ref or
    path can't inject shell metacharacters); otherwise delegates to the
    existing `readDocContent` working-tree path. Not itself responsible for
    resolving which repo — callers pass an already-resolved `repoPath`.

- **Route surface: extend, don't parallel.** Per the existing
  `docs/api-reference.md` shape (`GET /api/docs/content?repo=&path=`
  already returns `{ repo, path, format, content, itemId }`), this becomes:
  - `GET /api/docs/content?repo=&path=&ref=` — add an optional `ref` query
    param; when present, read via `readGitDoc(repoPath, path, ref)` instead
    of `readDocContent`. Same response shape, `ref` echoed back for the
    caller's context. This is the "same idea, extended" the task calls for —
    one content-fetch route, not two.
  - `GET /api/docs/resolve?text=` (new) — runs `extractDocCandidates` then
    `resolveInRepos` against every configured repo, returning candidate ->
    resolved `{ repo, path }` (or unresolved) pairs. This is the minimal UI
    hook point: a doc viewer can call this on a doc's rendered body, then
    call the existing `/api/docs/content?repo=&path=` for each resolved hit
    — reusing the one read mechanism rather than a second one.

## Security constraint: never resolve outside configured repo roots

Resolving a path across *multiple* filesystem locations is a real path-
traversal surface — a candidate like `../../../etc/passwd` or an absolute
path must never let `resolveInRepos`/`readGitDoc` read outside a configured
repo's own directory tree. The design enforces this at two points, not one:

1. **Candidate normalization in `resolveInRepos`.** Before checking
   existence, each `(repoRoot, candidate)` pair is resolved with Node's
   `path.resolve(repoRoot, candidate)` and checked that the result still
   starts with `repoRoot + path.sep` (or equals it). A candidate that
   resolves outside the repo root (via `../` segments or by being an
   absolute path that `path.resolve` treats as a full override) is rejected
   for that repo, not silently clamped. This mirrors the same
   join-then-verify shape as `readDocContent`'s existing
   `join(repoPath, relFilePath)`, just with an explicit boundary check
   added — `readDocContent` today has no such check because its `repoPath`
   is server-configured, but the caller-supplied `path` query param becomes
   more exposed once resolution starts trying it against *every* configured
   repo, so the check is added here rather than assumed.
2. **Repo universe is closed.** `resolveInRepos` only ever iterates the
   `repos: ProjectRegistry` map already loaded by `loadProjectRegistry()` at
   startup (itself filtered to paths that `existsSync` at load time) — there
   is no code path that accepts an arbitrary filesystem root from a request.
   The `GET /api/docs/resolve` route takes free-text to extract candidates
   from, never a path to search from.

`readGitDoc`'s ref-aware branch inherits the same boundary: it only runs
inside a `repoPath` that was itself resolved through the same
`resolveInRepos` check (or an already-trusted `repos[repo]` lookup, as the
existing `/api/docs/content` route does today), and `git show` is invoked
with `cwd: repoPath` and argument-array `execFileSync`, so neither `ref` nor
`relPath` can break out of that working directory via shell interpretation.

## Story breakdown (preview — see epic.yaml/stories/)

1. **s1** — `extractDocCandidates` + `resolveInRepos` as pure, tested
   functions in the new `server/adapters/gitdocs/index.ts`, including the
   path-traversal boundary check.
2. **s2** — `readGitDoc` (ref-aware read) + wiring: `ref` param on
   `GET /api/docs/content`, new `GET /api/docs/resolve` route. Depends on s1.

## Open questions

1. Should unresolved candidates (no configured repo has the path) surface
   as an explicit `null`/omitted entry the UI can render as "not found in
   any configured project," or be silently dropped from
   `GET /api/docs/resolve`'s response? This epic's design leans toward
   explicit (easier to debug a wrong candidate regex), but it's not settled
   against any UI mock — no UI file was read as part of this pass.
2. `resolveInRepos`'s "first match wins" when more than one configured repo
   happens to have a file at the same relative path — is first-registry-order
   the right tie-break, or should an ambiguous match be surfaced instead of
   silently picking one? The reference implementation isn't documented in
   enough detail (per `delphi-lineage-inventory.md`) to know which behavior
   it actually has; flagged rather than assumed.

## Scale assessment

Small/medium. One new adapter module (`server/adapters/gitdocs/index.ts`,
three functions) plus a small extension to one existing route file
(`server/routes/docs.ts`): an optional query param on the existing content
route and one new read-only route. No DB migration (this reads live
git/filesystem state, nothing persisted), no new dependencies (`git` is
invoked via Node's built-in `child_process`, same category of shell-out
`server/harness/transport.ts` already does for its own subprocess needs). No
UI redesign — the UI hook point is a route to call, not new screens.
Standalone-only throughout: pure local `git show` + path resolution against
the existing `project-registry.ts`, no Minerva/Multica/external coupling.
