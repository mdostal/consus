import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export interface ArtifactLinkRoutesOptions {
  db: Database.Database;
}

/**
 * REQ-05: store/serve claude.ai Artifact URLs associated with items, no
 * re-rendering — Delphi links, it does not reimplement the Artifact renderer.
 */
export function registerArtifactLinkRoutes(app: FastifyInstance, { db }: ArtifactLinkRoutesOptions): void {
  app.post<{ Params: { id: string }; Body: { url: string; label?: string } }>(
    "/api/items/:id/artifact-links",
    async (request, reply) => {
      const { id } = request.params;
      const { url, label } = request.body;

      db.prepare("INSERT INTO artifact_links (item_id, url, label) VALUES (?, ?, ?)").run(id, url, label ?? null);

      return reply.code(201).send({ ok: true });
    },
  );

  app.get<{ Params: { id: string } }>("/api/items/:id/artifact-links", async (request) => {
    const { id } = request.params;
    return db.prepare("SELECT id, url, label FROM artifact_links WHERE item_id = ?").all(id);
  });
}
