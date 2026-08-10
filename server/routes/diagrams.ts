import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { getCachedDiagram, setCachedDiagram } from "../db/diagrams-cache.js";
import { buildCascadeTree, renderCascadeMermaid } from "../lib/cascade-tree-builder.js";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import {
  buildRepoArchitectureGraph,
  renderArchitectureMermaid,
  docsFingerprint,
  type DiagramLevel,
} from "../features/diagrams/repo-architecture.js";
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

function repoArchitectureDiagramType(level: DiagramLevel): string {
  return `repo-architecture-${level}`;
}

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

  app.get<{ Params: { repo_id: string }; Querystring: { level?: string } }>(
    "/api/diagrams/repo/:repo_id/architecture",
    async (request, reply) => {
      const { repo_id: repoId } = request.params;
      const level: DiagramLevel = request.query.level === "full" ? "full" : "top";

      const repoPath = repos[repoId];
      if (!repoPath) {
        reply.code(404);
        return { error: `unknown repo: ${repoId}` };
      }

      const diagramType = repoArchitectureDiagramType(level);
      // Rescan before checking the fingerprint — otherwise a stale in-memory doc_index would
      // never notice on-disk .pHive doc changes and the cache would never invalidate.
      scanRepo(db, { repoName: repoId, repoPath });
      const fingerprint = docsFingerprint(db, repoId);
      const cached = getCachedDiagram(db, repoId, diagramType);
      if (cached && cached.docs_fingerprint === fingerprint) {
        return { mermaid: cached.mermaid_source, cached_at: cached.cached_at, stale: false };
      }

      const graph = buildRepoArchitectureGraph({ db, repoName: repoId, repoPath, level });
      const mermaid = renderArchitectureMermaid(graph);
      setCachedDiagram(db, repoId, diagramType, mermaid, fingerprint);
      const refreshed = getCachedDiagram(db, repoId, diagramType);

      return { mermaid, cached_at: refreshed?.cached_at ?? new Date().toISOString(), stale: false };
    },
  );
}
