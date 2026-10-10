import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { listProjects } from "../config/project-registry.js";
import { getProjectClients } from "../clients/store.js";
import { listInbox, markInboxSeen } from "../inbox/query.js";

export interface InboxRoutesOptions {
  db: Database.Database;
  /** Live project registry (repo name -> path), for each entry's client. */
  repos: Record<string, string>;
}

/** PANT-960: the cross-client inbox (server/inbox/query.ts) — open
 *  questions, proposals waiting for a result, and threads with a new reply. */
export function registerInboxRoutes(app: FastifyInstance, { db, repos }: InboxRoutesOptions): void {
  app.get<{ Querystring: { client?: string } }>("/api/inbox", async (request) => {
    const { client } = request.query ?? {};
    const clients = getProjectClients(db, listProjects(repos));
    return { items: listInbox(db, { clients, client: client || undefined }) };
  });

  app.post<{ Body: { itemId?: unknown } }>("/api/inbox/seen", async (request, reply) => {
    const { itemId } = request.body ?? {};
    if (typeof itemId !== "string" || !itemId) {
      return reply.code(400).send({ error: "itemId is required" });
    }
    if (!db.prepare("SELECT 1 FROM items WHERE id = ?").get(itemId)) {
      return reply.code(404).send({ error: `unknown item: ${itemId}` });
    }
    markInboxSeen(db, itemId);
    return { itemId, seen: true };
  });
}
