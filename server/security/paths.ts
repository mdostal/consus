import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * Filesystem boundary checks that hold through symlinks (first-cut-trust
 * t1e-consus-project-guard).
 *
 * A lexical `resolve()` + `startsWith(root + sep)` check (what every reader
 * here used before) stops `../` but not a symlink: a repo can carry
 * `docs/x.md -> /pantheon-secrets/token.env`, git stores symlinks, and the
 * plain read then follows it out of the project. Every check below compares
 * real paths (symlinks resolved) on both sides.
 */

/** True when `target` is `root` itself or inside it. Both should already be absolute and normalized. */
export function isWithin(root: string, target: string): boolean {
  if (target === root) return true;
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target.startsWith(prefix);
}

/** The real path of `path`, or its plain resolved form when it doesn't exist (nothing to follow). */
export function realOrResolved(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * The real path of `absPath` when it exists and its real path stays inside
 * `root`'s real path; `null` when it escapes. Throws the filesystem error
 * (ENOENT and so on) when `absPath` doesn't exist, so callers keep their
 * "no such file" handling.
 */
export function realPathInside(root: string, absPath: string): string | null {
  const realTarget = realpathSync(absPath);
  return isWithin(realOrResolved(root), realTarget) ? realTarget : null;
}

/** Like realPathInside, but a missing file is simply "not inside" (no throw). For directory walks. */
export function existsInside(root: string, absPath: string): boolean {
  try {
    return realPathInside(root, absPath) !== null;
  } catch {
    return false;
  }
}

export interface ProjectPathPolicy {
  /**
   * Where a project may live. Undefined: anywhere (a standalone install —
   * consus-phase25 kept typing any path as a way in). An array: inside one of
   * these directories only, and an empty array allows nothing. Consus passes
   * CONSUS_DISCOVERY_ROOTS here whenever the operator token guards it.
   */
  allowedRoots?: string[];
  /** Directories no project may be, sit inside, or contain (the shared secrets volume). Always applied. */
  protectedDirs: string[];
}

export type ProjectPathCheck = { ok: true; path: string } | { ok: false; status: 400 | 403; error: string };

/** The protected dir `realPath` is, sits in, or contains; undefined when it touches none. */
export function protectedDirTouched(realPath: string, protectedDirs: string[]): string | undefined {
  for (const dir of protectedDirs) {
    if (!dir) continue;
    const realDir = realOrResolved(dir);
    if (!existsSync(realDir)) continue;
    if (isWithin(realDir, realPath) || isWithin(realPath, realDir)) return dir;
  }
  return undefined;
}

/** True when `realPath` sits inside (or is) one of `roots` (compared by real path). */
export function insideAnyRoot(realPath: string, roots: string[]): boolean {
  return roots.some((root) => {
    if (!root) return false;
    const realRoot = realOrResolved(root);
    return existsSync(realRoot) && isWithin(realRoot, realPath);
  });
}

/**
 * Decides whether `path` may be registered as a project. Returns the real
 * path to register on success. Order: the path must exist as a directory
 * (400), must not be, sit in or contain a protected dir (403), and must sit
 * inside an allowed root when the policy has any (403).
 */
export function checkProjectPath(path: string, policy: ProjectPathPolicy): ProjectPathCheck {
  const resolved = resolve(path);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return { ok: false, status: 400, error: `path does not exist or is not a directory: ${resolved}` };
  }
  const real = realpathSync(resolved);

  const touched = protectedDirTouched(real, policy.protectedDirs);
  if (touched) {
    return { ok: false, status: 403, error: `path is, is inside, or contains the protected directory ${touched}: ${resolved}` };
  }

  const roots = policy.allowedRoots;
  if (roots === undefined) return { ok: true, path: real };
  if (roots.length === 0) {
    return {
      ok: false,
      status: 403,
      error: "project registration is closed: CONSUS_DISCOVERY_ROOTS is not set, so no path is allowed",
    };
  }
  if (!insideAnyRoot(real, roots)) {
    return { ok: false, status: 403, error: `path is outside CONSUS_DISCOVERY_ROOTS (${roots.join(", ")}): ${resolved}` };
  }
  return { ok: true, path: real };
}
