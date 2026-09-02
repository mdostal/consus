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

interface FeatureDoc {
  file_path: string;
  content_hash: string;
  last_scanned_at: string;
}

interface FeatureGroupedDocs {
  features: Array<{ epic: string; docCount: number; docs: FeatureDoc[] }>;
  overview: FeatureDoc[];
}

/** The item id a doc's propose-a-change proposals target (s5). One item per
 *  repo+path, mirroring diagrams' one-item-per-repo-diagram approach. */
export function docItemIdFor(repo: string, path: string): string {
  return `doc:${repo}:${path}`;
}

export function registerDocRoutes(app: FastifyInstance, { db, repos }: DocRoutesOptions): void {
  // s5 (consus-phase27-feature-doc-review-ui): scopedRepos is always derived
  // from Object.keys(repos) -- the live project registry this route handler
  // closes over (buildServer's `repos`, loaded from .pHive/consus-projects.json
  // and mutated in place by POST /api/projects) -- never from `SELECT DISTINCT
  // repo FROM doc_index` or any other doc_index-sourced list. That means a
  // repo whose doc_index rows outlive its deregistration (e.g. hand-editing
  // consus-projects.json to drop a repo, then restarting) is never queried
  // here and so never appears in this response, even though its rows are
  // still sitting in doc_index untouched -- this is a query-time exclusion,
  // re-derived fresh on every request, not a cached/hardcoded denylist and
  // not a destructive prune. If the repo is re-registered, its
  // previously-scanned docs reappear immediately with no re-scan needed.
  // GET /api/docs/features below uses this identical pattern -- the two
  // routes intentionally do not diverge on orphaned-repo handling.
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

  /**
   * s2 of consus-phase27-feature-doc-review-ui: a reshape of the same
   * doc_index data GET /api/docs returns (queryDocIndex, above), grouped
   * the way the feature-doc review UI actually needs it — one entry per
   * feature (non-null epic) with its doc count and doc list, plus a
   * separate "overview" bucket sourced from s1's repo-root README/VISION/
   * docs/** scan (phase='overview', epic=null). This is purely additive:
   * GET /api/docs's own shape and behavior are untouched above.
   *
   * Rows that are neither in a named epic nor phase='overview' (e.g.
   * .pHive/planning/** docs, which are epic=null, phase='planning') don't
   * belong in either bucket here and are intentionally omitted — GET
   * /api/docs remains the place to see those.
   *
   * s5 (consus-phase27-feature-doc-review-ui): registry-membership filter
   * against orphaned doc_index rows. Confirmed live against this repo's own
   * .pHive/consus.sqlite during this epic's research pass: 76 docs across
   * 29 epics sat in doc_index tagged repo="Portunus" while "Portunus" was
   * absent from .pHive/consus-projects.json — a leftover from an earlier
   * scan of a since-deregistered repo. Left unfiltered, this endpoint would
   * have surfaced 29 dead "features" pointing at a repo Consus can no
   * longer resolve a path for (repos/content lookups below all key off this
   * same `repos` map). scopedRepos, exactly as in GET /api/docs above, is
   * always derived from Object.keys(repos) — the live registry, re-read on
   * every request — never from a distinct-repo scan of doc_index itself, so
   * a deregistered repo's rows are excluded automatically without ever
   * issuing a DELETE against doc_index, and a later re-registration makes
   * them reappear immediately with no re-scan required.
   */
  app.get<{ Querystring: { project?: string } }>("/api/docs/features", async (request) => {
    const { project } = request.query;
    const scopedRepos = project ? Object.keys(repos).filter((r) => r === project) : Object.keys(repos);

    const docsByEpic = new Map<string, FeatureDoc[]>();
    const overview: FeatureDoc[] = [];

    for (const repo of scopedRepos) {
      for (const row of queryDocIndex(db, repo)) {
        const doc: FeatureDoc = {
          file_path: row.file_path,
          content_hash: row.content_hash,
          last_scanned_at: row.last_scanned_at,
        };
        if (row.phase === "overview") {
          overview.push(doc);
        } else if (row.epic !== null) {
          const docs = docsByEpic.get(row.epic) ?? [];
          docs.push(doc);
          docsByEpic.set(row.epic, docs);
        }
      }
    }

    const features = Array.from(docsByEpic.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([epic, docs]) => ({ epic, docCount: docs.length, docs }));

    const result: FeatureGroupedDocs = { features, overview };
    return result;
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
