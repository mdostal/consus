import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { decideItem, getAuditLog, createKbEntry, getKbVersions, type KbCollection } from "../kb/store.js";

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
        let sql = `SELECT DISTINCT e.* FROM kb_entries e
                 JOIN kb_versions v ON v.kb_entry_id = e.id
                 WHERE (e.title LIKE ? OR v.content LIKE ?)`;
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

  app.get<{ Params: { id: string } }>("/api/kb-entries/:id/versions", async (request) => {
    return getKbVersions(db, request.params.id);
  });
}
