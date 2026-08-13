import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { queryDocIndex, readDocContent } from "../adapters/doc-scanner/index.js";

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

  app.get<{ Querystring: { repo: string; path: string } }>("/api/docs/content", async (request, reply) => {
    const { repo, path } = request.query;
    const repoPath = repos[repo];
    if (!repoPath) {
      return reply.code(404).send({ error: `unknown repo: ${repo}` });
    }
    const { content, format } = readDocContent(repoPath, path);

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

    return { repo, path, format, content, itemId };
  });
}
