import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { readDocContent } from "../doc-scanner/index.js";

/**
 * REQ-20 foundation: port of `mdostal/delphi`'s `server/gitdocs.mjs` pipeline
 * (documented in `docs/delphi-lineage-inventory.md`, Source 2). This module
 * carries all three stages of that pipeline as independently-testable
 * functions: candidate extraction, closed-universe repo resolution, and
 * (below) `readGitDoc`'s ref-aware read.
 */

// A doc-path-like substring: one or more directory segments followed by a
// filename, ending in a known doc extension. Requiring at least one
// directory segment (the leading `(?:[\w.-]+\/)+`) is what naturally
// excludes bare filename-only mentions like "README.md" or "CLAUDE.md" with
// no path in front of them.
const DOC_PATH_PATTERN = /(?:[\w.-]+\/)+[\w.-]+\.(?:md|html)\b/g;

// Belt-and-suspenders noise filter matching the reference implementation's
// documented behavior: bare README.md/CLAUDE.md mentions are never real
// cross-repo pointers, even if some future change to DOC_PATH_PATTERN made
// them extractable without a directory segment.
const NOISE_FILENAMES = new Set(["README.md", "CLAUDE.md"]);

export function extractDocCandidates(text: string): string[] {
  const matches = text.match(DOC_PATH_PATTERN) ?? [];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const match of matches) {
    if (NOISE_FILENAMES.has(match)) continue;
    if (seen.has(match)) continue;
    seen.add(match);
    candidates.push(match);
  }

  return candidates;
}

export function resolveInRepos(
  candidate: string,
  repos: Record<string, string>,
): { repo: string; path: string } | null {
  for (const [name, repoRoot] of Object.entries(repos)) {
    const resolved = resolve(repoRoot, candidate);

    // SECURITY: the boundary check must happen before any filesystem call.
    // A plain startsWith(repoRoot) is NOT sufficient — it would let repoRoot
    // "/repos/foo" incorrectly accept a candidate resolving into the sibling
    // "/repos/foobar/secret.md", since "/repos/foobar".startsWith("/repos/foo")
    // is true. Requiring the path.sep suffix (or an exact match) closes that gap.
    const withinRepoRoot = resolved === repoRoot || resolved.startsWith(repoRoot + sep);
    if (!withinRepoRoot) continue;

    if (existsSync(resolved)) {
      return { repo: name, path: candidate };
    }
  }

  return null;
}

/**
 * Ref-aware doc read. When `ref` is given, reads the file's content as it
 * existed at that commit/branch/tag via `git show ref:relPath`. When `ref`
 * is omitted, delegates to the existing `readDocContent` working-tree read
 * rather than reimplementing it.
 *
 * SECURITY: `git show` is invoked via execFileSync with an argument array
 * (`["show", \`${ref}:${relPath}\`]`), never a concatenated/interpolated
 * shell command string passed to exec/execSync. execFileSync's argument-array
 * form passes each element as a single literal argv entry directly to the
 * `git` process — no shell is ever invoked to parse it — so shell
 * metacharacters in `ref` or `relPath` (e.g. `; rm -rf /` or `$(whoami)`)
 * cannot be interpreted as shell syntax; at worst `git show` fails to
 * resolve a bogus ref and throws.
 */
export function readGitDoc(
  repoPath: string,
  relPath: string,
  ref?: string,
): { content: string; format: "md" | "html" } {
  if (!ref) {
    return readDocContent(repoPath, relPath);
  }

  const content = execFileSync("git", ["show", `${ref}:${relPath}`], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  const format = relPath.endsWith(".html") ? "html" : "md";
  return { content, format };
}
