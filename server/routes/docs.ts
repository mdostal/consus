import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  queryDocIndex,
  readDocContent,
  DocPathEscapesRepoError,
  type DocIndexRow,
} from "../adapters/doc-scanner/index.js";
import { extractDocCandidates, readGitDoc, resolveInRepos } from "../adapters/gitdocs/index.js";
import {
  diffDocAtRef,
  readDocContentAtRef,
  resolveDefaultBranch,
  GitDocNotFoundError,
  UnresolvableRefError,
} from "../adapters/doc-scanner/git-ref.js";

export interface DocRoutesOptions {
  db: Database.Database;
  /** repo name -> absolute path on disk, needed to resolve file_path -> content */
  repos: Record<string, string>;
}

interface GroupedDocs {
  [repo: string]: {
    [phase: string]: Array<{
      epic: string | null;
      file_path: string;
      content_hash: string;
      last_scanned_at: string;
    }>;
  };
}

/** The item id a doc's propose-a-change proposals target (s5). One item per
 *  repo+path, mirroring diagrams' one-item-per-repo-diagram approach. */
export function docItemIdFor(repo: string, path: string): string {
  return `doc:${repo}:${path}`;
}

export function registerDocRoutes(app: FastifyInstance, { db, repos }: DocRoutesOptions): void {
  app.get<{ Querystring: { project?: string } }>("/api/docs", async (request) => {
    const { project } = request.query;
    const scopedRepos = project ? Object.keys(repos).filter((r) => r === project) : Object.keys(repos);

    const grouped: GroupedDocs = {};
    for (const repo of scopedRepos) {
      grouped[repo] = {};
      for (const row of queryDocIndex(db, repo)) {
        const phase = row.phase ?? "unphased";
        grouped[repo][phase] ??= [];
        grouped[repo][phase].push({
          epic: row.epic,
          file_path: row.file_path,
          content_hash: row.content_hash,
          last_scanned_at: row.last_scanned_at,
        });
      }
    }
    return grouped;
  });

  app.get<{ Querystring: { repo: string; path: string; ref?: string } }>(
    "/api/docs/content",
    async (request, reply) => {
      const { repo, path, ref } = request.query;
      const repoPath = repos[repo];
      if (!repoPath) {
        return reply.code(404).send({ error: `unknown repo: ${repo}` });
      }

      let content: string;
      let format: "md" | "html";
      if (ref) {
        // git show exits non-zero (execFileSync throws) for an invalid/
        // nonexistent ref — caught here so callers get a clear 400 instead
        // of an opaque 500.
        try {
          ({ content, format } = readGitDoc(repoPath, path, ref));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return reply.code(400).send({ error: `failed to read ${path} at ref ${ref}: ${message}` });
        }
      } else {
        try {
          ({ content, format } = readDocContent(repoPath, path));
        } catch (err) {
          if (err instanceof DocPathEscapesRepoError) {
            return reply.code(400).send({ error: err.message });
          }
          const code = (err as { code?: string }).code;
          if (code === "ENOENT") {
            return reply.code(404).send({ error: `no such file: ${path}` });
          }
          throw err;
        }
      }

      // Ensure a target item exists before the caller can propose a change to
      // this doc (s3's proposeChange requires a real item row) — upserted on
      // every open, matching the diagram route's pattern (s4).
      const itemId = docItemIdFor(repo, path);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO items (id, type, title, status, source_repo, source_ref, created_at, updated_at)
       VALUES (?, 'doc', ?, 'active', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).run(itemId, path, repo, path, now, now);

      return ref ? { repo, path, format, content, itemId, ref } : { repo, path, format, content, itemId };
    },
  );

  /**
   * s3 of consus-phase24-branch-level-surfacing: "what changed in this doc
   * on <ref> relative to the project's default branch" — the operator's
   * second explicit ask (design-discussion.md), e.g. "this PR should fix
   * the architecture for us to be multi-tenant."
   *
   * `base` defaults to the project's *real* default branch, resolved via
   * git-ref.ts's resolveDefaultBranch (a local `refs/remotes/origin/HEAD`
   * read) — deliberately never hardcoded to "main", since Consus's own repo
   * uses "dev" as its integration branch. If that resolution fails (no
   * origin/HEAD symref set locally) and no explicit `?base=` was given, the
   * request 400s asking the operator to pass one explicitly rather than
   * silently guessing a wrong default (see this story's risk mitigation).
   *
   * Existence at each ref is checked explicitly (via readDocContentAtRef)
   * before diffing: `git diff <base>...<ref> -- <path>` alone produces no
   * output both when the file is identical on both refs AND when it exists
   * on neither, and those need genuinely distinct responses (200 diff:null
   * vs. 404) per this story's acceptance criteria.
   */
  app.get<{ Querystring: { repo: string; path: string; ref: string; base?: string } }>(
    "/api/docs/diff",
    async (request, reply) => {
      const { repo, path, ref } = request.query;
      let { base } = request.query;
      const repoPath = repos[repo];
      if (!repoPath) {
        return reply.code(404).send({ error: `unknown repo: ${repo}` });
      }
      if (!path) {
        return reply.code(400).send({ error: "path is required" });
      }
      if (!ref) {
        return reply.code(400).send({ error: "ref is required" });
      }

      if (!base) {
        const resolved = resolveDefaultBranch(repoPath);
        if (!resolved) {
          return reply.code(400).send({
            error: `could not determine ${repo}'s default branch (no refs/remotes/origin/HEAD symref set locally) — pass ?base= explicitly`,
          });
        }
        base = resolved;
      }

      try {
        readDocContentAtRef(repoPath, ref, path);
        readDocContentAtRef(repoPath, base, path);
      } catch (err) {
        if (err instanceof UnresolvableRefError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof GitDocNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }

      const diff = diffDocAtRef(repoPath, ref, base, path);
      return { diff };
    },
  );

  app.get<{ Querystring: { text: string } }>("/api/docs/resolve", async (request) => {
    const { text } = request.query;
    const candidates = extractDocCandidates(text ?? "");

    const results = candidates.map((candidate) => {
      const resolution = resolveInRepos(candidate, repos);
      return resolution
        ? { candidate, resolved: true as const, repo: resolution.repo, path: resolution.path }
        : { candidate, resolved: false as const };
    });

    return { candidates: results };
  });

  app.get<{ Querystring: { q?: string; project?: string } }>("/api/docs/search", async (request, reply) => {
    const { q, project } = request.query;
    if (!q) {
      return reply.code(400).send({ error: "q is required" });
    }

    // Same scoping convention as GET /api/docs?project= — narrow to the one
    // configured repo when project is given, otherwise every configured repo.
    const scopedRepos = project ? Object.keys(repos).filter((r) => r === project) : Object.keys(repos);
    if (scopedRepos.length === 0) {
      return { query: q, results: [] };
    }

    type MatchEntry = DocIndexRow & { path: boolean; content: boolean };
    const byKey = new Map<string, MatchEntry>();
    const keyFor = (repo: string, filePath: string) => `${repo} ${filePath}`;

    // Dimension 1: path/repo match — parameterized LIKE, scoped identically
    // to the content pass below via the same repo IN (...) restriction.
    const repoPlaceholders = scopedRepos.map(() => "?").join(", ");
    const pathRows = db
      .prepare(
        `SELECT * FROM doc_index
         WHERE repo IN (${repoPlaceholders})
           AND (LOWER(repo) LIKE '%' || LOWER(?) || '%' OR LOWER(file_path) LIKE '%' || LOWER(?) || '%')`,
      )
      .all(...scopedRepos, q, q) as DocIndexRow[];

    for (const row of pathRows) {
      const key = keyFor(row.repo, row.file_path);
      const entry = byKey.get(key) ?? { ...row, path: false, content: false };
      entry.path = true;
      byKey.set(key, entry);
    }

    // Dimension 2: live content match — every in-scope doc_index row, not
    // just the ones that already path-matched, scoped by the same
    // scopedRepos list used above so project= narrows both passes alike.
    const qLower = q.toLowerCase();
    const allScopedRows = scopedRepos.flatMap((repo) => queryDocIndex(db, repo));
    for (const row of allScopedRows) {
      const repoPath = repos[row.repo];
      if (!repoPath) continue;

      let content: string;
      try {
        ({ content } = readDocContent(repoPath, row.file_path));
      } catch {
        // File unreadable (deleted since last scan, permissions issue, etc.)
        // — skip only the content dimension for this row, not the request.
        continue;
      }

      if (content.toLowerCase().includes(qLower)) {
        const key = keyFor(row.repo, row.file_path);
        const entry = byKey.get(key) ?? { ...row, path: false, content: false };
        entry.content = true;
        byKey.set(key, entry);
      }
    }

    const results = Array.from(byKey.values()).map((entry) => {
      const matched: Array<"path" | "content"> = [];
      if (entry.path) matched.push("path");
      if (entry.content) matched.push("content");
      return {
        repo: entry.repo,
        file_path: entry.file_path,
        epic: entry.epic,
        phase: entry.phase,
        matched,
        content_hash: entry.content_hash,
        last_scanned_at: entry.last_scanned_at,
      };
    });

    return { query: q, results };
  });
}
