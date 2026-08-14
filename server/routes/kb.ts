import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  decideItem,
  getAuditLog,
  createKbEntry,
  getKbVersions,
  saveKbDraft,
  getKbDraftVersions,
  type KbCollection,
} from "../kb/store.js";
import { triggerApprovalPipeline } from "../kb/pipeline.js";

export interface KbRoutesOptions {
  db: Database.Database;
}

const VALID_COLLECTIONS: readonly KbCollection[] = [
  "marketing",
  "boundary-decisions",
  "plans",
  "artifacts",
  "general",
];

function isValidCollection(value: string): value is KbCollection {
  return (VALID_COLLECTIONS as readonly string[]).includes(value);
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
  // kb-01: optional ?collection= scopes to one collection bucket.
  app.get<{ Querystring: { q?: string; project?: string; collection?: string } }>(
    "/api/kb-entries",
    async (request, reply) => {
      const { q, project, collection } = request.query;

      if (collection && !isValidCollection(collection)) {
        return reply.code(400).send({
          error: `invalid collection "${collection}" — must be one of ${VALID_COLLECTIONS.join(", ")}`,
        });
      }

      if (q) {
        const params: string[] = [`%${q}%`, `%${q}%`];
        // p11-03: v.state = 'published' keeps draft kb_versions rows
        // (p11-01's saveKbDraft) from ever surfacing in search results —
        // without this, unsubmitted draft content would leak here.
        let sql = `SELECT DISTINCT e.* FROM kb_entries e
                 JOIN kb_versions v ON v.kb_entry_id = e.id
                 WHERE v.state = 'published' AND (e.title LIKE ? OR v.content LIKE ?)`;
        if (project) {
          sql += " AND e.source_repo = ?";
          params.push(project);
        }
        if (collection) {
          sql += " AND e.collection = ?";
          params.push(collection);
        }
        sql += " ORDER BY e.created_at DESC";
        return db.prepare(sql).all(...params);
      }

      const conditions: string[] = [];
      const params: string[] = [];
      if (project) {
        conditions.push("source_repo = ?");
        params.push(project);
      }
      if (collection) {
        conditions.push("collection = ?");
        params.push(collection);
      }
      const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
      return db.prepare(`SELECT * FROM kb_entries${where} ORDER BY created_at DESC`).all(...params);
    },
  );

  app.put<{ Params: { id: string }; Body: { author: string; content: string } }>(
    "/api/kb-entries/:id",
    async (request) => {
      const { id } = request.params;
      const { author, content } = request.body;
      const existing = db.prepare("SELECT title FROM kb_entries WHERE id = ?").get(id) as
        | { title: string }
        | undefined;

      createKbEntry(db, { id, title: existing?.title ?? id, author, content });
      return { ok: true };
    },
  );

  // p11-01/p11-03 ("Save != Submit"): persists a draft kb_versions row via
  // saveKbDraft() only. Never calls triggerApprovalPipeline — the HTTP
  // layer preserves the same one-way isolation p11-02 established at the
  // module layer (store.ts never imports from pipeline.ts).
  app.put<{ Params: { id: string }; Body: { author: string; content: string; title?: string } }>(
    "/api/kb-entries/:id/draft",
    async (request) => {
      const { id } = request.params;
      const { author, content, title } = request.body;
      const existing = db.prepare("SELECT title, source_repo FROM kb_entries WHERE id = ?").get(id) as
        | { title: string; source_repo: string | null }
        | undefined;

      saveKbDraft(db, {
        id,
        title: existing?.title ?? title ?? id,
        author,
        content,
        sourceRepo: existing?.source_repo ?? null,
      });

      // saveKbDraft() returns void, so the newly-saved draft row is looked
      // up back out via getKbDraftVersions() (ordered by id ASC) — the last
      // entry is the one just inserted.
      const drafts = getKbDraftVersions(db, id);
      const draft = drafts[drafts.length - 1];
      const current = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get(id) as {
        current_version_id: number | null;
      };
      return { draft, currentVersionId: current.current_version_id };
    },
  );

  // Submit: explicitly fires the approve->phase-split->KB pipeline,
  // promoting a draft version to published. If versionId is omitted, the
  // latest draft (via getKbDraftVersions()) is used.
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
