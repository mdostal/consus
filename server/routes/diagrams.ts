import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { getCachedDiagram, setCachedDiagram } from "../db/diagrams-cache.js";
import { buildCascadeTree, renderCascadeMermaid } from "../lib/cascade-tree-builder.js";
import type { MulticaClient } from "../adapters/multica/client.js";

export interface DiagramRoutesOptions {
  db: Database.Database;
  client: MulticaClient;
  /** repo name -> absolute path on disk, scanned for .pHive/epics/*\/epic.yaml */
  repos: Record<string, string>;
}

const CASCADE_DIAGRAM_TYPE = "cascade";
/** Risk mitigation from this story's plan: Multica may be slow/unavailable, so the cascade is cached for 5 minutes and served stale on fetch error. */
const CASCADE_CACHE_TTL_MS = 5 * 60 * 1000;

export function registerDiagramRoutes(app: FastifyInstance, { db, client, repos }: DiagramRoutesOptions): void {
  app.get("/api/diagrams/cascade", async (request, reply) => {
    const cached = getCachedDiagram(db, null, CASCADE_DIAGRAM_TYPE);
    if (cached && Date.now() - Date.parse(cached.cached_at) < CASCADE_CACHE_TTL_MS) {
      return { mermaid: cached.mermaid_source, cached_at: cached.cached_at, stale: false };
    }

    const result = await buildCascadeTree({ client, repos });
    if (!result.ok) {
      if (cached) {
        return { mermaid: cached.mermaid_source, cached_at: cached.cached_at, stale: true };
      }
      reply.code(502);
      return { error: `Multica fetch failed: ${result.error}` };
    }

    const mermaid = renderCascadeMermaid(result.forest);
    setCachedDiagram(db, null, CASCADE_DIAGRAM_TYPE, mermaid);
    const refreshed = getCachedDiagram(db, null, CASCADE_DIAGRAM_TYPE);

    return { mermaid, cached_at: refreshed?.cached_at ?? new Date().toISOString(), stale: false };
  });
}
