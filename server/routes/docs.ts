import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { basename } from "node:path";
import { queryDocIndex, readDocContent, type DocIndexRow } from "../adapters/doc-scanner/index.js";
import type { MulticaClient } from "../adapters/multica/client.js";

export interface DocRoutesOptions {
  db: Database.Database;
  /** repo name -> absolute path on disk, needed to resolve file_path -> content */
  repos: Record<string, string>;
  client?: MulticaClient;
}

interface GroupedDocs {
  [repo: string]: {
    [phase: string]: Array<{
      id: number;
      epic: string | null;
      file_path: string;
      content_hash: string;
      last_scanned_at: string;
      fired_at: string | null;
      multica_issue_id: string | null;
      multica_issue_url: string | null;
    }>;
  };
}

interface StoredDocRow extends DocIndexRow {
  editable_content?: unknown;
  fired_at: string | null;
  multica_issue_id: string | null;
  multica_issue_url: string | null;
}

function getDocById(db: Database.Database, id: number): StoredDocRow | null {
  return db.prepare("SELECT * FROM doc_index WHERE id = ?").get(id) as StoredDocRow | undefined ?? null;
}

function contentForDoc(row: StoredDocRow, repoPath: string): string {
  return typeof row.editable_content === "string" && row.editable_content.trim()
    ? row.editable_content
    : readDocContent(repoPath, row.file_path).content;
}

function docTitle(row: StoredDocRow, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || basename(row.file_path).replace(/\.[^.]+$/, "");
}

function composeIssueBody(row: StoredDocRow, title: string, content: string, firedAt: string): string {
  return `## Doc: ${title}
**Type:** ${row.phase ?? "unphased"}
**Target Repo:** ${row.repo}

${content}

---
Fired from Consus on ${firedAt}`;
}

export function registerDocRoutes(app: FastifyInstance, { db, repos, client }: DocRoutesOptions): void {
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
          id: row.id,
          epic: row.epic,
          file_path: row.file_path,
          content_hash: row.content_hash,
          last_scanned_at: row.last_scanned_at,
          fired_at: "fired_at" in row ? (row as StoredDocRow).fired_at : null,
          multica_issue_id: "multica_issue_id" in row ? (row as StoredDocRow).multica_issue_id : null,
          multica_issue_url: "multica_issue_url" in row ? (row as StoredDocRow).multica_issue_url : null,
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
    return { repo, path, format, content };
  });

  app.post<{ Params: { id: string } }>("/api/docs/:id/fire", async (request, reply) => {
    if (!client) {
      return reply.code(503).send({ error: "Multica client not configured" });
    }

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: "invalid doc id" });
    }

    const doc = getDocById(db, id);
    if (!doc) {
      return reply.code(404).send({ error: "doc not found" });
    }

    const repoPath = repos[doc.repo];
    if (!repoPath) {
      return reply.code(404).send({ error: `unknown repo: ${doc.repo}` });
    }

    let content: string;
    try {
      content = contentForDoc(doc, repoPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `failed to read doc content: ${message}` });
    }

    const firedAt = new Date().toISOString();
    const title = docTitle(doc, content);
    const body = composeIssueBody(doc, title, content, firedAt);
    const created = await client.createIssue({
      title: `Fire doc: ${title}`,
      body,
      labels: ["consus:fired"],
    });

    if (!created.ok) {
      const statusCode = /not configured|unavailable/i.test(created.error) ? 503 : 502;
      return reply.code(statusCode).send({ error: created.error });
    }

    db.prepare(
      `
      UPDATE doc_index
      SET fired_at = ?, multica_issue_id = ?, multica_issue_url = ?
      WHERE id = ?
    `,
    ).run(firedAt, created.issueId, created.issueUrl, id);

    return {
      docId: id,
      issueId: created.issueId,
      issueUrl: created.issueUrl,
      firedAt,
    };
  });
}
