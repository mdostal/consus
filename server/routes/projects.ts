import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { listProjects } from "../config/project-registry.js";

export interface ProjectRoutesOptions {
  db: Database.Database;
  /** repo name -> absolute path on disk, needed to resolve :project to a scan target */
  repos: Record<string, string>;
}

/**
 * s1: the sole new backend capability in this epic — wires the existing
 * (previously untriggered) doc-scanner to an on-demand HTTP route. Nothing
 * else in Consus needs an ingest step: diagrams read epic/story YAML
 * straight off disk on every call, and KB entries come from the decision
 * flow — only doc_index needs this explicit trigger.
 */
export function registerProjectRoutes(app: FastifyInstance, { db, repos }: ProjectRoutesOptions): void {
  app.get("/api/projects", async () => {
    return { projects: listProjects(repos) };
  });

  app.post<{ Params: { project: string } }>("/api/projects/:project/ingest", async (request, reply) => {
    const { project } = request.params;
    const repoPath = repos[project];
    if (!repoPath) {
      return reply.code(404).send({ error: `unknown project: ${project}` });
    }

    scanRepo(db, { repoName: project, repoPath });

    const row = db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get(project) as { n: number };
    return { project, docsScanned: row.n };
  });
}
