import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { decideItem, getAuditLog, createKbEntry, getKbVersions, saveKbDraft, getKbDraftVersions } from "../kb/store.js";
import { triggerApprovalPipeline } from "../kb/pipeline.js";

export interface KbRoutesOptions {
  db: Database.Database;
}

export function registerKbRoutes(app: FastifyInstance, { db }: KbRoutesOptions): void {
  app.post<{ Params: { id: string }; Body: { actor: string; newStatus: string } }>(
    "/api/items/:id/decide",
    async (request, reply) => {
      const { id } = request.params;
      const { actor, newStatus } = request.body;

      try {
        decideItem(db, { itemId: id, actor, newStatus });
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("item not found")) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }

      const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id);
      return { item, auditLog: getAuditLog(db, id) };
    },
  );

  // REQ-09 (P1 stretch): full KB backlog browse (search/filter across ALL
  // entries) + direct edit, versioned like every other write.
  // REQ-27: optional ?project= scopes to one project's entries; omitted
  // returns every project's entries (the "global" cross-project case).
  app.get<{ Querystring: { q?: string; project?: string } }>("/api/kb-entries", async (request) => {
    const { q, project } = request.query;

    if (q) {
      const params: string[] = [`%${q}%`, `%${q}%`];
      let sql = `SELECT DISTINCT e.* FROM kb_entries e
                 JOIN kb_versions v ON v.kb_entry_id = e.id
                 WHERE v.state = 'published' AND (e.title LIKE ? OR v.content LIKE ?)`;
      if (project) {
        sql += " AND e.source_repo = ?";
        params.push(project);
      }
      sql += " ORDER BY e.created_at DESC";
      return db.prepare(sql).all(...params);
    }

    if (project) {
      return db.prepare("SELECT * FROM kb_entries WHERE source_repo = ? ORDER BY created_at DESC").all(project);
    }
    return db.prepare("SELECT * FROM kb_entries ORDER BY created_at DESC").all();
  });

  app.put<{
    Params: { id: string };
    Body: {
      author: string;
      content: string;
      collection?: "marketing" | "boundary-decisions" | "plans" | "artifacts" | "general";
    };
  }>(
    "/api/kb-entries/:id",
    async (request) => {
      const { id } = request.params;
      const { author, content, collection } = request.body;
      const existing = db.prepare("SELECT title FROM kb_entries WHERE id = ?").get(id) as
        | { title: string }
        | undefined;

      createKbEntry(db, { id, title: existing?.title ?? id, author, content, collection });
      return { ok: true };
    },
  );

  app.put<{ Params: { id: string }; Body: { author: string; content: string; title?: string } }>(
    "/api/kb-entries/:id/draft",
    async (request) => {
      const { id } = request.params;
      const { author, content, title } = request.body;
      const existing = db.prepare("SELECT title, source_repo, current_version_id FROM kb_entries WHERE id = ?").get(id) as
        | { title: string; source_repo: string | null; current_version_id: number | null }
        | undefined;

      const draft = saveKbDraft(db, {
        id,
        title: existing?.title ?? title ?? id,
        author,
        content,
        sourceRepo: existing?.source_repo ?? null,
      });
      const current = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get(id) as {
        current_version_id: number | null;
      };
      return { draft, currentVersionId: current.current_version_id };
    },
  );

  // Submit: explicitly fires the approve->phase-split->KB pipeline, promoting
  // a draft version to published. Never called from the Save path above —
  // isolation between the two is asserted in tests.
  app.post<{ Params: { id: string }; Body: { actor: string; versionId?: number } }>(
    "/api/kb-entries/:id/submit",
    async (request, reply) => {
      const { id } = request.params;
      const { actor, versionId } = request.body;

      let targetVersionId = versionId;
      if (targetVersionId == null) {
        const drafts = getKbDraftVersions(db, id);
        const latestDraft = drafts[drafts.length - 1];
        if (!latestDraft) {
          return reply.code(404).send({ error: `no draft version found for entry: ${id}` });
        }
        targetVersionId = latestDraft.id;
      }

      try {
        const result = triggerApprovalPipeline(db, { id, versionId: targetVersionId, actor });
        return { ok: true, ...result };
      } catch (err) {
        if (
          err instanceof Error &&
          (err.message.startsWith("kb_entry not found") || err.message.startsWith("kb_version not found"))
        ) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/kb-entries/:id/versions", async (request) => {
    return getKbVersions(db, request.params.id);
  });

  app.get<{ Params: { id: string } }>("/api/kb-entries/:id/drafts", async (request) => {
    return getKbDraftVersions(db, request.params.id);
  });
}
