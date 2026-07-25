import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { decideItem, getAuditLog } from "../kb/store.js";

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
}
