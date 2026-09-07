import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

export interface DesignAssetRoutesOptions {
  /** repo name -> absolute path on disk. Same map every other route keyed
   *  by `?repo=` (docs.ts, diagrams.ts) closes over — sourced from the live
   *  project registry, never a separate copy. */
  repos: Record<string, string>;
}

// Image-only allowlist, mirroring server/routes/attachments.ts's
// EXTENSION_MIME_TYPES: extension-based, not real content-sniffing on the
// file's bytes (a malicious file renamed with an allowed extension isn't
// caught) — same known, accepted v1 scope as attachments.ts. This route
// only ever serves *wireframe images* (the Hive /design skill's
// v1.png/v2.png renditions), so the allowlist is narrower than attachments'
// — no pdf/txt/md/csv/json/zip, image types only.
//
// SECURITY: as in attachments.ts, the served Content-Type is always derived
// server-side from the (already-allowlisted) extension, never from any
// client input — there's no client-supplied mimetype here at all (this
// route reads straight off disk, it doesn't accept uploads), but the
// derive-don't-trust posture is kept identical for consistency and so the
// two routes can't quietly drift apart.
const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};
const ALLOWED_EXTENSIONS = Object.keys(EXTENSION_MIME_TYPES);

/**
 * Thrown when the requested `path` resolves outside `.pHive/design/` for the
 * given repo — a path-traversal attempt, or simply a path that was never
 * under that directory in the first place. Distinguished by name so the
 * route can 400 with a clear message rather than an opaque throw.
 */
export class DesignAssetPathEscapesRootError extends Error {
  constructor(relFilePath: string) {
    super(`path escapes .pHive/design root: ${relFilePath}`);
    this.name = "DesignAssetPathEscapesRootError";
  }
}

/**
 * Resolves `relFilePath` (a repo-relative path, e.g.
 * ".pHive/design/my-topic/v1.png") to an absolute path, requiring it to
 * land inside `<repoPath>/.pHive/design/` — a strictly narrower boundary
 * than doc-scanner's readDocContent (which only requires staying inside the
 * whole repo), matching this story's AC3 ("no path traversal outside
 * .pHive/design/").
 *
 * SECURITY: mirrors readDocContent's exact boundary-check idiom (doc-scanner
 * /index.ts) — the check happens before any filesystem call, and a plain
 * startsWith(designRoot) is NOT sufficient on its own: it would let
 * designRoot ".../.pHive/design" incorrectly accept a path resolving into a
 * sibling directory like ".../.pHive/design-secret/..." purely by string
 * prefix. Requiring the path.sep suffix (or an exact match) closes that gap.
 */
export function resolveDesignAssetPath(repoPath: string, relFilePath: string): string {
  const designRoot = resolve(repoPath, ".pHive", "design");
  const absPath = resolve(repoPath, relFilePath);

  const withinDesignRoot = absPath === designRoot || absPath.startsWith(designRoot + sep);
  if (!withinDesignRoot) {
    throw new DesignAssetPathEscapesRootError(relFilePath);
  }

  return absPath;
}

/**
 * s3 (consus-phase28-interaction-completeness): serves image assets
 * (wireframe renditions, etc.) from a repo's `.pHive/design/<topic>/`
 * directory — the one gap attachments.ts doesn't cover, since attachments
 * are keyed by an opaque attachment id in a DB table (server/storage/),
 * while design images are keyed by their repo-relative path on disk. Same
 * safety posture as attachments.ts (extension allowlist, server-derived
 * Content-Type, nosniff, inline for image types), deliberately not reusing
 * that route directly per this story's design_decisions.
 */
export function registerDesignAssetRoutes(app: FastifyInstance, { repos }: DesignAssetRoutesOptions): void {
  app.get<{ Querystring: { repo: string; path: string } }>("/api/design-assets", async (request, reply) => {
    const { repo, path } = request.query;

    const repoPath = repos[repo];
    if (!repoPath) {
      return reply.code(404).send({ error: `unknown repo: ${repo}` });
    }
    if (!path) {
      return reply.code(400).send({ error: "path is required" });
    }

    const ext = extname(path).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return reply.code(400).send({ error: "File type not allowed" });
    }

    let absPath: string;
    try {
      absPath = resolveDesignAssetPath(repoPath, path);
    } catch (err) {
      if (err instanceof DesignAssetPathEscapesRootError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    if (!existsSync(absPath)) {
      return reply.code(404).send({ error: `no such file: ${path}` });
    }

    const mimeType = EXTENSION_MIME_TYPES[ext];
    const buffer = readFileSync(absPath);

    // Every allowed extension here is an image type, so — unlike
    // attachments.ts, which forces non-inline-safe types to download — this
    // route always serves inline. X-Content-Type-Options is kept anyway,
    // matching attachments.ts's defense-in-depth posture exactly.
    reply.header("Content-Type", mimeType);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Disposition", "inline");

    return reply.send(buffer);
  });
}
