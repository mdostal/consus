import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { queryDocIndex, readDocContent, type DocIndexRow } from "../adapters/doc-scanner/index.js";
import type { MulticaClient } from "../adapters/multica/client.js";

const EDITABLE_PATH_PREFIX = join(".pHive", "epics") + "/";

/** Rejects paths outside `.pHive/epics/` (also blocks `..` traversal) once resolved against repoPath. */
function isEditablePath(repoPath: string, path: string): boolean {
  if (!path.startsWith(EDITABLE_PATH_PREFIX)) {
    return false;
  }
  const rel = relative(join(repoPath, EDITABLE_PATH_PREFIX), join(repoPath, path));
  return rel !== "" && !rel.startsWith("..");
}

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

export interface FiredTicketRow {
  id: string;
  multica_issue_id: string;
  target_repo: string;
  fired_by: string;
  fired_at: string;
  repo: string;
  file_path: string;
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

    const edit = db
      .prepare("SELECT content FROM doc_edits WHERE repo = ? AND file_path = ? ORDER BY created_at DESC LIMIT 1")
      .get(repo, path) as { content: string } | undefined;

    if (edit) {
      return { repo, path, format: path.endsWith(".html") ? "html" : "md", content: edit.content, source: "edit" };
    }

    const { content, format } = readDocContent(repoPath, path);
    return { repo, path, format, content, source: "disk" };
  });

  app.put<{
    Body: { repo: string; path: string; content: string; commit_to_disk?: boolean; edited_by?: string };
  }>("/api/docs/content", async (request, reply) => {
    const { repo, path, content, commit_to_disk = false, edited_by = "consus" } = request.body;

    const repoPath = repos[repo];
    if (!repoPath) {
      return reply.code(400).send({ error: `unknown repo: ${repo}` });
    }
    if (!isEditablePath(repoPath, path)) {
      return reply.code(400).send({ error: "only .pHive/epics docs are editable" });
    }

    const existing = db
      .prepare(
        "SELECT id FROM doc_edits WHERE repo = ? AND file_path = ? AND content = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(repo, path, content) as { id: string } | undefined;

    if (existing) {
      return { edit_id: existing.id, committed: false, deduped: true };
    }

    const editId = `e-${randomUUID()}`;
    db.prepare(
      "INSERT INTO doc_edits (id, repo, file_path, content, edited_by, committed_to_disk) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(editId, repo, path, content, edited_by, commit_to_disk ? 1 : 0);

    if (commit_to_disk) {
      const fullPath = join(repoPath, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }

    return { edit_id: editId, committed: commit_to_disk };
  });


  app.get<{ Params: { id: string } }>("/api/docs/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid doc id" });

    const doc = getDocById(db, id);
    if (!doc) return reply.code(404).send({ error: "doc not found" });

    const repoPath = repos[doc.repo];
    if (!repoPath) return reply.code(404).send({ error: `unknown repo: ${doc.repo}` });

    const edit = db
      .prepare("SELECT content FROM doc_edits WHERE repo = ? AND file_path = ? ORDER BY created_at DESC LIMIT 1")
      .get(doc.repo, doc.file_path) as { content: string } | undefined;

    let content, format, source;
    if (edit) {
      format = doc.file_path.endsWith(".html") ? "html" : "md";
      content = edit.content;
      source = "edit";
    } else {
      const res = readDocContent(repoPath, doc.file_path);
      content = res.content;
      format = res.format;
      source = "disk";
    }

    return {
      id: doc.id,
      repo: doc.repo,
      path: doc.file_path,
      format,
      content,
      source,
      fired_at: doc.fired_at,
      multica_issue_id: doc.multica_issue_id,
      multica_issue_url: doc.multica_issue_url,
      epic: doc.epic,
      last_scanned_at: doc.last_scanned_at,
    };
  });

  app.put<{
    Params: { id: string };
    Body: { content: string; commit_to_disk?: boolean; edited_by?: string };
  }>("/api/docs/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid doc id" });

    const doc = getDocById(db, id);
    if (!doc) return reply.code(404).send({ error: "doc not found" });

    const repo = doc.repo;
    const path = doc.file_path;
    const { content, commit_to_disk = false, edited_by = "consus" } = request.body;

    const repoPath = repos[repo];
    if (!repoPath) return reply.code(400).send({ error: `unknown repo: ${repo}` });
    if (!isEditablePath(repoPath, path)) return reply.code(400).send({ error: "only .pHive/epics docs are editable" });

    const existing = db
      .prepare(
        "SELECT id FROM doc_edits WHERE repo = ? AND file_path = ? AND content = ? ORDER BY created_at DESC LIMIT 1"
      )
      .get(repo, path, content) as { id: string } | undefined;

    if (existing) {
      return { edit_id: existing.id, committed: false, deduped: true };
    }

    const editId = `e-${randomUUID()}`;
    db.prepare(
      "INSERT INTO doc_edits (id, repo, file_path, content, edited_by, committed_to_disk) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(editId, repo, path, content, edited_by, commit_to_disk ? 1 : 0);

    if (commit_to_disk) {
      const fullPath = join(repoPath, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }

    return { edit_id: editId, committed: commit_to_disk };
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

    const firedBy = "consus";
    const existingEdit = db
      .prepare(
        "SELECT id FROM doc_edits WHERE repo = ? AND file_path = ? AND content = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(doc.repo, doc.file_path, content) as { id: string } | undefined;
    const editId =
      existingEdit?.id ??
      (() => {
        const newEditId = `e-${randomUUID()}`;
        db.prepare(
          "INSERT INTO doc_edits (id, repo, file_path, content, edited_by, committed_to_disk) VALUES (?, ?, ?, ?, ?, 0)",
        ).run(newEditId, doc.repo, doc.file_path, content, firedBy);
        return newEditId;
      })();

    db.prepare(
      "INSERT INTO fired_tickets (id, edit_id, multica_issue_id, target_repo, fired_by, fired_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(`ft-${randomUUID()}`, editId, created.issueId, doc.repo, firedBy, firedAt);

    return {
      docId: id,
      issueId: created.issueId,
      issueUrl: created.issueUrl,
      firedAt,
    };
  });

  app.get("/api/fired", async () => {
    return db
      .prepare(
        `
        SELECT
          ft.id,
          ft.multica_issue_id,
          ft.target_repo,
          ft.fired_by,
          ft.fired_at,
          de.repo,
          de.file_path
        FROM fired_tickets ft
        JOIN doc_edits de ON ft.edit_id = de.id
        ORDER BY ft.fired_at DESC
      `,
      )
      .all() as FiredTicketRow[];
  });
}
