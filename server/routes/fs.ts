import type { FastifyInstance } from "fastify";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface FsListEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

export interface FsRoutesOptions {
  /** Overrides os.homedir() — test-only seam so the default-to-home-dir
   *  behavior can be exercised hermetically against a real temp directory,
   *  mirroring server/index.ts's webRoot override convention. Production
   *  callers (server/index.ts's buildServer) never pass this. */
  homeDir?: string;
}

/** True when `path` (raw, pre-resolve query value) contains a literal `..`
 *  path segment — checked before resolve() ever runs so a value like
 *  `foo/../../etc` is rejected outright rather than resolved and then
 *  found to point somewhere unintended. */
function containsTraversalSegment(rawPath: string): boolean {
  return rawPath.split(/[/\\]/).includes("..");
}

/**
 * Lists `dirPath`'s immediate subdirectories only (one level deep — a
 * caller wanting to go deeper calls again with a subdirectory as the new
 * path). Each entry flags `isRepo` true when the subdirectory directly
 * contains a `.git` or `.pHive` entry.
 *
 * A subdirectory entry that throws on stat (permission denied, broken
 * symlink) is silently omitted rather than failing the whole listing.
 *
 * Exported (not handler-only) because s3-fs-discovery-endpoint reuses this
 * directly instead of duplicating the traversal logic.
 */
export function listSubdirectories(dirPath: string): FsListEntry[] {
  const entries: FsListEntry[] = [];

  for (const name of readdirSync(dirPath)) {
    const entryPath = join(dirPath, name);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch {
      // permission denied, broken symlink, etc — omit this one entry
      // rather than failing the whole listing.
      continue;
    }

    const isRepo = existsSync(join(entryPath, ".git")) || existsSync(join(entryPath, ".pHive"));
    entries.push({ name, path: entryPath, isRepo });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * s2: the one generic filesystem-discovery building block this codebase has
 * — reads directory structure beyond any project the operator has
 * explicitly registered, a materially different exposure category than
 * every other route (which only ever touch registered-repo paths). Intended
 * for the default HOST=127.0.0.1 (loopback-only) binding; see
 * docs/api-reference.md's callout for why this is unsuitable behind
 * HOST=0.0.0.0.
 */
export function registerFsRoutes(app: FastifyInstance, { homeDir = homedir() }: FsRoutesOptions = {}): void {
  app.get<{ Querystring: { path?: string } }>("/api/fs/list", async (request, reply) => {
    const { path } = request.query ?? {};

    if (path && containsTraversalSegment(path)) {
      return reply.code(400).send({ error: `path may not contain ".." segments: ${path}` });
    }

    const dirPath = resolve(path || homeDir);
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      return reply.code(400).send({ error: `path does not exist or is not a directory: ${dirPath}` });
    }

    return { path: dirPath, entries: listSubdirectories(dirPath) };
  });
}
