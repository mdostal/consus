import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { posix, resolve, sep } from "node:path";
import type { HarnessTransport } from "../harness/transport.js";
import { proposeChange } from "../proposals/store.js";
import { DOC_TEMPLATES, findDocTemplate, newFileDiff } from "../lib/doc-templates.js";
import { docItemIdFor } from "./docs.js";

export interface NewDocRoutesOptions {
  db: Database.Database;
  /** repo name -> absolute path on disk (same registry docs/diagram routes use) */
  repos: Record<string, string>;
  transport: HarnessTransport;
}

interface NewDocBody {
  repo?: string;
  path?: string;
  template?: string;
  content?: string;
  description?: string;
  requestedBy?: string;
}

const NEW_FILE_EXTENSIONS = [".md", ".mmd"];

/**
 * Repo-relative, forward-slash form of `path`, or null when it is absolute
 * or climbs out of the repo. The on-disk boundary check below still runs on
 * the resolved path, same as readDocContent's.
 */
function normalizeNewPath(path: string): string | null {
  const unified = path.trim().replace(/\\/g, "/");
  if (!unified || unified.startsWith("/")) return null;
  const normalized = posix.normalize(unified);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") return null;
  return normalized;
}

/**
 * "New doc" / "New diagram" (PANT-965). Consus never writes the repo: a new
 * file goes out as a proposal through the same proposeChange dispatch every
 * edit uses, with a `/dev/null` diff header marking it as a creation (see
 * newFileDiff). The harness creates the file and reports back through
 * POST /api/proposals/:id/result as usual.
 */
export function registerNewDocRoutes(app: FastifyInstance, { db, repos, transport }: NewDocRoutesOptions): void {
  app.get("/api/docs/templates", async () => {
    return { templates: DOC_TEMPLATES };
  });

  app.post<{ Body: NewDocBody }>("/api/docs/new", async (request, reply) => {
    const { repo, path, template: templateId, content, description, requestedBy } = request.body ?? {};
    if (!repo || !path) {
      return reply.code(400).send({ error: "repo and path are required" });
    }
    const repoPath = repos[repo];
    if (!repoPath) {
      return reply.code(404).send({ error: `unknown repo: ${repo}` });
    }

    const relPath = normalizeNewPath(path);
    const absPath = relPath ? resolve(repoPath, relPath) : null;
    if (!relPath || !absPath || !absPath.startsWith(repoPath + sep)) {
      return reply.code(400).send({ error: `path must be relative and inside the repo: ${path}` });
    }
    const extension = NEW_FILE_EXTENSIONS.find((ext) => relPath.endsWith(ext));
    if (!extension) {
      return reply.code(400).send({ error: `path must end in ${NEW_FILE_EXTENSIONS.join(" or ")}` });
    }

    const template = templateId ? findDocTemplate(templateId) : undefined;
    if (templateId && !template) {
      return reply.code(400).send({ error: `unknown template: ${templateId}` });
    }
    if (template && template.extension !== extension) {
      return reply.code(400).send({ error: `template ${template.id} creates ${template.extension} files, not ${extension}` });
    }
    const fileContent = typeof content === "string" ? content : template?.content;
    if (fileContent === undefined) {
      return reply.code(400).send({ error: "template or content is required" });
    }

    if (existsSync(absPath)) {
      return reply.code(409).send({ error: `file already exists: ${relPath}` });
    }

    const itemId = docItemIdFor(repo, relPath);
    const pending = db
      .prepare("SELECT id FROM proposals WHERE item_id = ? AND status = 'pending' LIMIT 1")
      .get(itemId) as { id: string } | undefined;
    if (pending) {
      return reply.code(409).send({ error: `a proposal for ${relPath} is already pending: ${pending.id}` });
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO items (id, type, title, status, source_repo, source_ref, created_at, updated_at)
       VALUES (?, 'doc', ?, 'active', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(itemId, relPath, repo, relPath, now, now);

    const result = await proposeChange(db, transport, {
      itemId,
      targetType: "doc",
      diff: newFileDiff(relPath, fileContent),
      description: description?.trim() || `Create ${relPath}`,
      requestedBy: requestedBy || "consus",
    });
    if (!result.ok) {
      return reply.code(404).send({ error: result.error });
    }

    const proposal = db.prepare("SELECT * FROM proposals WHERE id = ?").get(result.proposalId);
    return reply.code(201).send({ repo, path: relPath, itemId, proposal });
  });
}
