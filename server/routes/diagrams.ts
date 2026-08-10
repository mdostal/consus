import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { MulticaClient } from "../adapters/multica/client.js";
import { getCachedDiagram, invalidateDiagram, setCachedDiagram } from "../db/diagrams-cache.js";
import { buildCascadeTree } from "../features/diagrams/cascade-tree.js";

const CASCADE_DIAGRAM_TYPE = "cascade";
const CASCADE_STATE_TYPE = "cascade_state";

export interface DiagramRoutesOptions {
  db: Database.Database;
  client: Pick<MulticaClient, "listEpics" | "listStories">;
  pHiveRoot: string;
}

export function registerDiagramRoutes(app: FastifyInstance, { db, client, pHiveRoot }: DiagramRoutesOptions): void {
  app.get("/api/diagrams/cascade", async (_request, reply) => {
    try {
      const cascade = await buildCascadeTree({ client, pHiveRoot });
      const cachedDiagram = getCachedDiagram(db, null, CASCADE_DIAGRAM_TYPE);
      const cachedState = getCachedDiagram(db, null, CASCADE_STATE_TYPE);

      if (cachedDiagram && cachedState?.mermaid_source === cascade.stateSignature) {
        return {
          diagram_type: CASCADE_DIAGRAM_TYPE,
          mermaid_source: cachedDiagram.mermaid_source,
          cached_at: cachedDiagram.cached_at,
          cached: true,
        };
      }

      invalidateDiagram(db, null, CASCADE_DIAGRAM_TYPE);
      invalidateDiagram(db, null, CASCADE_STATE_TYPE);
      setCachedDiagram(db, null, CASCADE_DIAGRAM_TYPE, cascade.mermaidSource);
      setCachedDiagram(db, null, CASCADE_STATE_TYPE, cascade.stateSignature);
      const refreshed = getCachedDiagram(db, null, CASCADE_DIAGRAM_TYPE);

      return {
        diagram_type: CASCADE_DIAGRAM_TYPE,
        mermaid_source: cascade.mermaidSource,
        cached_at: refreshed?.cached_at ?? new Date().toISOString(),
        cached: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `failed to generate cascade diagram: ${message}` });
    }
  });
}
