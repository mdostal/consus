import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export interface ArtifactLinkRoutesOptions {
  db: Database.Database;
}

/**
 * REQ-05: store/serve claude.ai Artifact URLs associated with items, no
 * re-rendering — Consus links, it does not reimplement the Artifact renderer.
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

  /**
   * PANT-937: removes a dead or wrong link. The link row itself goes, but an
   * audit_log row (`field: "artifact_link"`, old_value the removed link as
   * JSON) keeps the history. `actor` comes from the JSON body or `?actor=`.
   */
  app.delete<{ Params: { id: string; linkId: string }; Querystring: { actor?: string }; Body: { actor?: unknown } }>(
    "/api/items/:id/artifact-links/:linkId",
    async (request, reply) => {
      const { id, linkId } = request.params;
      const actor = (request.body as { actor?: unknown } | undefined)?.actor ?? request.query?.actor;
      if (typeof actor !== "string" || !actor) {
        return reply.code(400).send({ error: "actor is required" });
      }

      const link = db
        .prepare("SELECT id, url, label FROM artifact_links WHERE id = ? AND item_id = ?")
        .get(linkId, id) as { id: number; url: string; label: string | null } | undefined;
      if (!link) {
        return reply.code(404).send({ error: `artifact link ${linkId} not found on item ${id}` });
      }

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare("DELETE FROM artifact_links WHERE id = ?").run(link.id);
        db.prepare(
          "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, actor, "artifact_link", JSON.stringify(link), null, now);
      })();

      return reply.code(204).send();
    },
  );
}
