# Design Discussion — consus-phase24-branch-level-surfacing

## 0. Prelude

This item sat deliberately parked in the backlog since roughly 2026-08-13, quoted verbatim in
`vision-and-way-of-working.md`: *"we can leave the PR part out for now and keep it 0... we need
that as most of the work is going to be in progress and across branches as it comes in."* Explicit
operator go-ahead given 2026-08-18, with two concrete asks:

1. "We have to enable the branch level decisions so the branch can move forward and we need to be
   able to link that up and display that 100%."
2. "If there are doc changes or things, ideally we can see what the change in the doc that goes
   along with it is from the MAIN/MASTER so that we can say — ahh, this PR should fix the
   architecture for us to be multi-tenant — etc."

## 1. Goal

Today Consus only surfaces **settled, merged-to-`main`** state — decisions, docs, KB entries all
come from a scan of whatever's currently checked out on disk. Most real work lives in-progress on
a feature branch before it ever reaches `main`. This epic lets an operator point Consus at a
specific branch and see: (a) the open decisions that live on that branch (so they can be resolved
and the branch can move forward), and (b) what changed in a doc on that branch relative to `main`
(so an operator can see the actual architectural delta a branch/PR represents, not just its
existence).

## 2. What's already there vs. what's missing (read directly off the current codebase, not assumed)

- **Doc scanning is disk-only, ref-blind.** `server/adapters/doc-scanner/index.ts` walks
  `.pHive/planning/` and `.pHive/epics/**` via plain `fs.readdirSync`/`readFileSync` against
  whatever `repoPath` (from `CONSUS_PROJECTS_CONFIG`) currently has checked out. There is no git
  concept anywhere in the scanning path today.
- **`items.source_ref` already exists but means something else.** It looks like exactly the right
  column name for "which git ref this decision came from," but reading the two real call sites
  (`server/events/detect.ts:265`, `server/routes/events.ts:154`) shows it's actually populated with
  the **source doc's file path**, not a git ref. This column cannot be repurposed without breaking
  existing decision-item upsert behavior — branch scoping needs a genuinely new column.
  **This is a real, previously-undocumented finding from this epic's own research, not something
  the operator flagged — worth being explicit about since it changes the shape of the schema
  change below.**
- **No GitHub API integration exists anywhere in this codebase**, and Consus's whole architecture
  (repeated, explicit rule all session) is standalone with zero live coupling to any external
  service. Everything Consus does today is either local SQLite/filesystem or the generic
  `HarnessTransport` seam (opt-in, local-command-only).

## 3. The central design fork: git-local vs. GitHub API

The operator's own framing uses "PR" language ("when a PR is made... this PR should fix the
architecture"), which could mean either of two real approaches:

**Option A — git-local only (recommended).** Every branch already exists as a git ref before any
PR is opened around it. Consus can read any local or fetched branch's content directly via git
plumbing (`git show <ref>:<path>` for a file's content at that ref, `git diff
<default-branch>...<ref> -- <path>` for what changed) against the repo path already configured in
`CONSUS_PROJECTS_CONFIG` — no GitHub API call, no GitHub token, no new external dependency. "Is
there a PR open for this branch" is a presentational label Consus doesn't need to know to deliver
the actual value (decisions + doc diff for in-progress work). This keeps Consus's standalone,
zero-live-coupling architecture completely intact — the exact same principle that governed the
Multica/Minerva strip this session did earlier.

**Option B — real GitHub API integration.** Consus calls GitHub's REST/GraphQL API to list open
PRs, their titles, review status, etc., and correlates that with branch content. This gives richer
metadata (PR title/number/author/CI status) but is a genuine new category of external coupling —
Consus would need a GitHub token, network calls to a third-party service, and rate-limit/auth
handling. This is a materially different, larger epic than "read a branch's content."

**This design discussion recommends Option A** — it delivers exactly what both operator asks
require (branch-scoped decisions, doc diff against main) with zero new external coupling, and
doesn't foreclose Option B later (a GitHub-metadata layer could be added on top of the git-local
foundation as its own future epic, if ever wanted). Presented to the operator as an open question
below rather than silently decided, since it's a real architectural fork with a real coupling
implication.

## 4. Proposed approach (Option A)

1. **Ref-aware doc reading.** Add a `readDocContentAtRef(repoPath, ref, filePath)` alongside the
   existing disk-based `readDocContent` — shells out to `git show <ref>:<path>` (repoPath is
   already a real git working copy, since it's a repo Consus already scans). Requires the ref to
   be resolvable locally (already checked out or already fetched) — Consus does not run `git
   fetch` itself (that would be a real, if minor, new network-touching behavior — worth its own
   explicit sign-off if ever wanted; out of scope here, flagged as a risk below).

2. **Ref-aware scan.** A new `POST /api/projects/:project/ingest?ref=<branch>` (or a small sibling
   route — implementer's call, consistent with existing route conventions) walks the same
   `.pHive/planning/`/`.pHive/epics/**` tree but at `<ref>` instead of the working-tree disk state,
   using `git ls-tree -r <ref> --name-only` (not `fs.readdirSync`) to enumerate files and
   `readDocContentAtRef` to read them.

3. **Branch-scoped decision items.** A new `source_branch TEXT` column on `items` (NOT `source_ref`
   — see §2's finding) records which branch a decision-request block was scanned from. The default
   (unset/main-branch scan) behaves exactly as it does today — this is additive, not a breaking
   schema change. `GET /api/decisions?branch=<name>` filters to that branch's items; the existing
   unfiltered call keeps today's exact behavior (main-branch/default scan only, unchanged).

4. **Doc diff endpoint.** `GET /api/docs/diff?repo=<name>&path=<file>&ref=<branch>&base=<default>`
   returns a real `git diff <base>...<ref> -- <path>` for that one doc — this is what lets an
   operator see "this branch's version of architecture.md vs. main's version" and read the actual
   delta (e.g., the multi-tenancy example from the operator's own ask).

5. **UI: a branch picker + diff view.** `ProjectView` gains a branch selector (populated from `git
   branch -a` /or/ `git for-each-ref` against the configured repo — implementer's call on exact
   listing command); selecting a branch re-scopes the decisions list to that branch's items and
   surfaces a "view diff vs. main" action next to any doc that differs from the default branch's
   version, rendering the diff inline (reuse whatever diff-rendering approach already exists in
   this codebase if one does — the proposals feature already renders diffs, per
   `docs/api-reference.md`'s Proposals section; check `server/routes/proposals.ts` and its
   consuming UI for a pattern to reuse rather than inventing a second diff renderer).

## 5. Scale assessment

**Large** — new git-plumbing capability, a new schema column, new API surface, and new UI
(branch picker + diff view), with one genuine unresolved architectural fork (§3) that changes the
shape of the work depending on the answer. This gets the full review treatment: presented to the
operator before story decomposition, not silently scoped.

## 6. Open questions for the operator

1. **Git-local (Option A) vs. GitHub API (Option B) — §3.** Recommendation is Option A
   (git-local-only, zero new external coupling). Confirm, or say if PR metadata (title/number/CI
   status) genuinely matters enough to justify a GitHub API dependency as a separate, later epic.
2. **Should Consus ever run `git fetch` itself** to pull a remote branch it doesn't have locally
   yet, or is "the branch must already be fetched/checked out locally" an acceptable v1
   constraint? Recommendation: acceptable v1 constraint — avoids Consus initiating its own network
   calls, keeps the git-plumbing additions read-only against local refs.
3. **Does "branch" mean local branches, remote-tracking branches, or both?** Recommendation: both
   — resolve `<ref>` through git's normal ref resolution (works for `feat/x` local or
   `origin/feat/x` remote-tracking without Consus needing to know which).

## 7. Risks

- **Shelling out to git is a new pattern for this codebase** (everything today is `fs`/SQLite).
  Needs careful argument handling (no shell injection via a branch name or path containing shell
  metacharacters — use `execFile`/spawn with an argument array, never string-interpolated shell
  commands) and clear error handling for a ref that doesn't resolve locally.
- **Large diffs / binary files.** A doc diff against a very different branch state could be large;
  `git diff` on binary-classified files (shouldn't apply to `.md`/`.html` docs, but worth a
  defensive check) needs a sane fallback rather than dumping binary noise into a JSON response.
