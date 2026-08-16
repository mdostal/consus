import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * REQ-20 foundation: port of `mdostal/delphi`'s `server/gitdocs.mjs` pipeline
 * (documented in `docs/delphi-lineage-inventory.md`, Source 2). This module
 * carries the first two stages — candidate extraction and closed-universe
 * repo resolution — as pure, independently-testable functions. `readGitDoc`
 * (git show / working-tree read) is added by a later story in this epic.
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
