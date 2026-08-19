import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import { DOC_EXTENSIONS, SCAN_ROOTS } from "./index.js";

/**
 * Ref-aware git plumbing (s1 of consus-phase24-branch-level-surfacing). This
 * module complements the disk-based `./index.ts` scanner by reading
 * `.pHive/planning/**`/`.pHive/epics/**` docs as they exist at an arbitrary
 * local git ref, instead of whatever's currently checked out on disk.
 *
 * SECURITY: every git invocation below uses execFileSync with an argument
 * array, never a concatenated/interpolated shell command string passed to
 * exec/execSync. execFileSync's argument-array form passes each element as
 * a single literal argv entry directly to the `git` process — no shell is
 * ever invoked to parse it — so shell metacharacters in `ref`, `path`, or
 * `base` (e.g. `; rm -rf /` or `$(whoami)`) cannot be interpreted as shell
 * syntax; at worst git fails to resolve a bogus ref/path and throws. This
 * mirrors the precedent already established by `readGitDoc` in
 * ../gitdocs/index.ts.
 *
 * Consus never runs `git fetch` itself (design-discussion.md, open question
 * 2, operator-confirmed): a ref that isn't already resolvable locally
 * (not fetched/checked out) is a client error the operator must remediate
 * themselves, surfaced here as the typed UnresolvableRefError below rather
 * than a raw git stderr dump or an uncaught throw.
 */

/**
 * Thrown when `ref` (or `base`) does not resolve to a local commit — i.e.
 * it isn't a branch, tag, or commit sha that's already fetched/checked out
 * in the repo at `repoPath`. Distinguishable via `instanceof` from
 * GitDocNotFoundError (a resolvable ref whose content lookup still failed,
 * e.g. a path that doesn't exist at that ref) so callers can map the two
 * cases to different HTTP statuses (s2/s3) instead of string-matching a
 * generic Error's message.
 */
export class UnresolvableRefError extends Error {
  constructor(public readonly ref: string) {
    super(`git ref does not resolve locally (not fetched or checked out): ${ref}`);
    this.name = "UnresolvableRefError";
  }
}

/**
 * Thrown when `ref` resolves locally but the requested file does not exist
 * at that ref (e.g. a bad/stale path, or a path that was added/removed
 * between refs). Distinguishable via `instanceof` from UnresolvableRefError
 * — see that class's doc comment for why this distinction matters.
 */
export class GitDocNotFoundError extends Error {
  constructor(
    public readonly ref: string,
    public readonly filePath: string,
  ) {
    super(`no such file at ref '${ref}': ${filePath}`);
    this.name = "GitDocNotFoundError";
  }
}

/** Runs `git rev-parse --verify --quiet <ref>^{commit}` to confirm `ref`
 *  resolves to a local commit, throwing UnresolvableRefError if not. Kept
 *  as its own step (rather than inferring resolution from a downstream
 *  command's failure) so a resolvable ref whose *content* lookup fails
 *  (GitDocNotFoundError) is never misreported as an unresolvable ref. */
function assertRefResolvesLocally(repoPath: string, ref: string): void {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: repoPath,
      encoding: "utf-8",
    });
  } catch {
    throw new UnresolvableRefError(ref);
  }
}

function isUnderScanRoots(relPath: string): boolean {
  return SCAN_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

function isDocExtension(relPath: string): boolean {
  return DOC_EXTENSIONS.has(extname(relPath));
}

/**
 * Enumerates `.pHive/planning/**`/`.pHive/epics/**` `.md`/`.html` files as
 * they exist at `ref`, via `git ls-tree -r <ref> --name-only`. Filtered to
 * the same SCAN_ROOTS/DOC_EXTENSIONS the disk-based scanner in ./index.ts
 * uses, imported (not redefined) so the two scanning paths can't drift.
 */
export function listFilesAtRef(repoPath: string, ref: string): string[] {
  assertRefResolvesLocally(repoPath, ref);

  const output = execFileSync("git", ["ls-tree", "-r", ref, "--name-only"], {
    cwd: repoPath,
    encoding: "utf-8",
  });

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((relPath) => relPath.length > 0)
    .filter(isUnderScanRoots)
    .filter(isDocExtension);
}

/**
 * Returns a file's content as it existed at `ref`, via `git show
 * <ref>:<path>`. Throws GitDocNotFoundError if `ref` resolves but `path`
 * doesn't exist at it; throws UnresolvableRefError if `ref` itself doesn't
 * resolve locally.
 */
export function readDocContentAtRef(repoPath: string, ref: string, filePath: string): string {
  assertRefResolvesLocally(repoPath, ref);

  try {
    return execFileSync("git", ["show", `${ref}:${filePath}`], {
      cwd: repoPath,
      encoding: "utf-8",
    });
  } catch {
    throw new GitDocNotFoundError(ref, filePath);
  }
}

/**
 * Returns a unified diff of `path` between `base` and `ref` (`git diff
 * <base>...<ref> -- <path>`), or `null` if there's no difference — matching
 * the `diff: string | null` convention already established by
 * server/events/store.ts's EventRow.diff and consumed by
 * server/routes/events.ts's `event.diff` handling (a null diff means
 * "nothing to show/propose", not an empty string). Throws
 * UnresolvableRefError if either `ref` or `base` doesn't resolve locally.
 */
export function diffDocAtRef(repoPath: string, ref: string, base: string, filePath: string): string | null {
  assertRefResolvesLocally(repoPath, ref);
  assertRefResolvesLocally(repoPath, base);

  const output = execFileSync("git", ["diff", `${base}...${ref}`, "--", filePath], {
    cwd: repoPath,
    encoding: "utf-8",
  });

  return output.length > 0 ? output : null;
}
