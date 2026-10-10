import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { basename } from "node:path";
import type { HarnessTransport } from "../harness/transport.js";
import { readDocContent, DocPathEscapesRepoError } from "../adapters/doc-scanner/index.js";
import { generateArchitectureDiagrams } from "../lib/diagram-generator.js";
import { mermaidToSvg } from "../lib/mermaid-svg.js";
import {
  buildCascadeMermaid,
  buildClaudePrompt,
  diagramToMarkdown,
  diagramToStandaloneHtml,
  docToStandaloneHtml,
  normalizeImportedContent,
} from "../lib/send-out.js";
import { computeLineDiff } from "../events/diff.js";
import { proposeChange } from "../proposals/store.js";
import { ensureDocItem } from "./docs.js";
import { ensureDiagramItem, readCascadeEpics } from "./diagrams.js";

export interface SendOutRoutesOptions {
  db: Database.Database;
  /** repo name -> absolute path on disk (same registry the docs routes use) */
  repos: Record<string, string>;
  transport: HarnessTransport;
}

/** The three diagrams Consus renders per repo. */
export const DIAGRAM_KINDS = ["cascade", "architecture", "architecture-full"] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

const DOC_FORMATS = ["md", "html", "claude-prompt"] as const;
const DIAGRAM_FORMATS = ["mmd", "svg", "md", "html", "claude-prompt"] as const;

const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  mmd: "text/plain; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
  "claude-prompt": "text/plain; charset=utf-8",
};

function isDiagramKind(kind: unknown): kind is DiagramKind {
  return typeof kind === "string" && (DIAGRAM_KINDS as readonly string[]).includes(kind);
}

function diagramMermaid(repoPath: string, kind: DiagramKind): string {
  if (kind === "cascade") return buildCascadeMermaid(readCascadeEpics(repoPath));
  const { topLevel, fullComponent } = generateArchitectureDiagrams(repoPath);
  return kind === "architecture" ? topLevel : fullComponent;
}

function diagramTitle(repo: string, kind: DiagramKind): string {
  return kind === "cascade" ? `${repo} epic/story cascade` : `${repo} ${kind === "architecture" ? "architecture" : "full component architecture"}`;
}

/** The originating Consus server, for the URLs inside the Claude prompt. */
function consusUrlFor(request: FastifyRequest): string {
  return `${request.protocol}://${request.headers.host ?? "127.0.0.1:8722"}`;
}

/** Sends an export body. Downloads get an attachment Content-Disposition;
 *  the Claude prompt is meant for the clipboard, so it's served inline. */
function sendExport(reply: FastifyReply, format: string, filename: string, body: string) {
  reply.header("content-type", CONTENT_TYPES[format]);
  if (format !== "claude-prompt") {
    const safe = filename.replace(/[^\w.-]+/g, "_");
    reply.header("content-disposition", `attachment; filename="${safe}"`);
  }
  return reply.send(body);
}

type ReadResult = { ok: true; content: string; format: "md" | "html" } | { ok: false; code: number; error: string };

function readDoc(repos: Record<string, string>, repo: string, path: string): ReadResult {
  const repoPath = repos[repo];
  if (!repoPath) return { ok: false, code: 404, error: `unknown repo: ${repo}` };
  try {
    return { ok: true, ...readDocContent(repoPath, path) };
  } catch (err) {
    if (err instanceof DocPathEscapesRepoError) return { ok: false, code: 400, error: err.message };
    if ((err as { code?: string }).code === "ENOENT") return { ok: false, code: 404, error: `no such file: ${path}` };
    throw err;
  }
}

/**
 * PANT-964 "send out": export any doc or diagram as a file, hand it to an
 * interactive Claude session ("Open in Claude"), record the artifact it was
 * published as, and bring the edited result back as a proposal. Consus still
 * never writes a repo: import-back only ever creates a proposal through the
 * configured harness transport.
 */
export function registerSendOutRoutes(app: FastifyInstance, { db, repos, transport }: SendOutRoutesOptions): void {
  app.get<{ Querystring: { repo?: string; path?: string; format?: string } }>(
    "/api/export/doc",
    async (request, reply) => {
      const { repo, path, format = "md" } = request.query;
      if (!repo || !path) return reply.code(400).send({ error: "repo and path are required" });
      if (!(DOC_FORMATS as readonly string[]).includes(format)) {
        return reply.code(400).send({ error: `format must be one of: ${DOC_FORMATS.join(", ")}` });
      }

      const doc = readDoc(repos, repo, path);
      if (!doc.ok) return reply.code(doc.code).send({ error: doc.error });
      const itemId = ensureDocItem(db, repo, path);
      const stem = basename(path).replace(/\.(md|markdown|html?)$/i, "");

      if (format === "claude-prompt") {
        const prompt = buildClaudePrompt({
          itemId,
          title: path,
          contentFormat: doc.format,
          content: doc.content,
          consusUrl: consusUrlFor(request),
        });
        return sendExport(reply, format, "", prompt);
      }
      if (format === "html") {
        return sendExport(reply, format, `${stem}.html`, docToStandaloneHtml(path, doc.format, doc.content, itemId));
      }
      // "md" is the raw source as stored — for an .html doc that's its HTML.
      return sendExport(reply, doc.format === "html" ? "html" : "md", basename(path), doc.content);
    },
  );

  app.get<{ Querystring: { repo?: string; kind?: string; format?: string } }>(
    "/api/export/diagram",
    async (request, reply) => {
      const { repo, kind = "cascade", format = "mmd" } = request.query;
      if (!repo) return reply.code(400).send({ error: "repo is required" });
      if (!isDiagramKind(kind)) {
        return reply.code(400).send({ error: `kind must be one of: ${DIAGRAM_KINDS.join(", ")}` });
      }
      if (!(DIAGRAM_FORMATS as readonly string[]).includes(format)) {
        return reply.code(400).send({ error: `format must be one of: ${DIAGRAM_FORMATS.join(", ")}` });
      }
      const repoPath = repos[repo];
      if (!repoPath) return reply.code(404).send({ error: `unknown repo: ${repo}` });

      const itemId = ensureDiagramItem(db, repo);
      const mermaid = diagramMermaid(repoPath, kind);
      const title = diagramTitle(repo, kind);
      const stem = `${repo}-${kind}`;

      switch (format) {
        case "svg":
          // Every kind Consus generates is a flowchart, so this never falls
          // through to null in practice; guarded anyway.
          return sendExport(reply, format, `${stem}.svg`, mermaidToSvg(mermaid, title) ?? "");
        case "md":
          return sendExport(reply, format, `${stem}.md`, diagramToMarkdown(title, mermaid));
        case "html":
          return sendExport(reply, format, `${stem}.html`, diagramToStandaloneHtml(title, mermaid, itemId));
        case "claude-prompt":
          return sendExport(
            reply,
            format,
            "",
            buildClaudePrompt({
              itemId,
              title,
              contentFormat: "mmd",
              content: mermaid,
              consusUrl: consusUrlFor(request),
              diagramKind: kind,
            }),
          );
        default:
          return sendExport(reply, "mmd", `${stem}.mmd`, `${mermaid}\n`);
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/items/:id/claude-artifact", async (request, reply) => {
    const row = db.prepare("SELECT id, claude_artifact_url FROM items WHERE id = ?").get(request.params.id) as
      | { id: string; claude_artifact_url: string | null }
      | undefined;
    if (!row) return reply.code(404).send({ error: `item not found: ${request.params.id}` });
    return { itemId: row.id, url: row.claude_artifact_url };
  });

  /** Sets (or, with url null/"", clears) the item's published Claude
   *  artifact URL. Audited like every other item field change. */
  app.put<{ Params: { id: string }; Body: { url?: unknown; actor?: unknown } }>(
    "/api/items/:id/claude-artifact",
    async (request, reply) => {
      const { id } = request.params;
      const { url, actor } = request.body ?? {};
      if (typeof actor !== "string" || !actor) return reply.code(400).send({ error: "actor is required" });
      const next = url === null || url === undefined || url === "" ? null : url;
      if (next !== null && (typeof next !== "string" || !/^https:\/\/\S+$/i.test(next))) {
        return reply.code(400).send({ error: "url must be an https:// URL, or null to clear" });
      }

      const row = db.prepare("SELECT claude_artifact_url FROM items WHERE id = ?").get(id) as
        | { claude_artifact_url: string | null }
        | undefined;
      if (!row) return reply.code(404).send({ error: `item not found: ${id}` });

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare("UPDATE items SET claude_artifact_url = ?, updated_at = ? WHERE id = ?").run(next, now, id);
        db.prepare(
          "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, actor, "claude_artifact_url", row.claude_artifact_url, next, now);
      })();
      return { itemId: id, url: next };
    },
  );

  /**
   * Import back: the edited .md/.mmd (pasted or uploaded) becomes a
   * proposal against the original item, with the diff computed against the
   * item's current content. Never writes the repo.
   */
  app.post<{
    Params: { id: string };
    Body: { content?: unknown; filename?: unknown; description?: unknown; requestedBy?: unknown; kind?: unknown };
  }>("/api/items/:id/import", async (request, reply) => {
    const { id } = request.params;
    const { content, filename, description, requestedBy, kind = "cascade" } = request.body ?? {};
    if (typeof content !== "string" || !content.trim()) return reply.code(400).send({ error: "content is required" });
    if (typeof requestedBy !== "string" || !requestedBy) return reply.code(400).send({ error: "requestedBy is required" });

    const item = db.prepare("SELECT id, type, source_repo, source_ref FROM items WHERE id = ?").get(id) as
      | { id: string; type: string; source_repo: string | null; source_ref: string | null }
      | undefined;
    if (!item) return reply.code(404).send({ error: `item not found: ${id}` });

    let original: string;
    if (item.type === "doc" && item.source_repo && item.source_ref) {
      const doc = readDoc(repos, item.source_repo, item.source_ref);
      if (!doc.ok) return reply.code(doc.code).send({ error: doc.error });
      original = doc.content;
    } else if (item.type === "diagram" && item.source_repo) {
      if (!isDiagramKind(kind)) {
        return reply.code(400).send({ error: `kind must be one of: ${DIAGRAM_KINDS.join(", ")}` });
      }
      const repoPath = repos[item.source_repo];
      if (!repoPath) return reply.code(404).send({ error: `unknown repo: ${item.source_repo}` });
      original = `${diagramMermaid(repoPath, kind)}\n`;
    } else {
      return reply.code(400).send({ error: `import is supported for doc and diagram items, not ${item.type}` });
    }

    const edited = normalizeImportedContent(content, original, item.type);
    if (edited === original) {
      return reply.code(422).send({ error: "imported content is identical to the current content; nothing to propose" });
    }

    const source = typeof filename === "string" && filename ? filename : "pasted content";
    const note = typeof description === "string" && description.trim() ? `: ${description.trim()}` : "";
    const result = await proposeChange(db, transport, {
      itemId: id,
      targetType: item.type,
      diff: computeLineDiff(original, edited),
      description: `Imported from outside Consus (${source})${note}`,
      requestedBy,
    });
    if (!result.ok) return reply.code(404).send({ error: result.error });
    return reply.code(201).send(db.prepare("SELECT * FROM proposals WHERE id = ?").get(result.proposalId));
  });
}
