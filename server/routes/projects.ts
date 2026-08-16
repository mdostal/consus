import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { listProjects } from "../config/project-registry.js";
import { detectEvents } from "../events/detect.js";

export interface ProjectRoutesOptions {
  db: Database.Database;
  /** repo name -> absolute path on disk, needed to resolve :project to a scan target */
  repos: Record<string, string>;
}

/** `file_path -> content_hash` snapshot of a repo's doc_index rows, read
 *  before scanRepo's upsert runs — the "prior hash" p14-2's doc_changed
 *  pass needs to tell new/changed files apart from unchanged ones. */
function snapshotDocIndexHashes(db: Database.Database, repoName: string): Map<string, string> {
  const rows = db
    .prepare("SELECT file_path, content_hash FROM doc_index WHERE repo = ?")
    .all(repoName) as Array<{ file_path: string; content_hash: string }>;
  return new Map(rows.map((row) => [row.file_path, row.content_hash]));
}

/**
 * s1: the sole new backend capability in this epic — wires the existing
 * (previously untriggered) doc-scanner to an on-demand HTTP route. Nothing
 * else in Consus needs an ingest step: diagrams read epic/story YAML
 * straight off disk on every call, and KB entries come from the decision
 * flow — only doc_index needs this explicit trigger.
 *
 * p14-2: both routes below run the identical snapshot + scanRepo +
 * detectEvents sequence, via the same detectEvents entry point — per the
 * operator's resolved "all three scan granularities coexist" call, every
 * scan trigger (single-project ingest, scan-all, any future ad-hoc trigger)
 * must produce events identically.
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

    const previousHashes = snapshotDocIndexHashes(db, project);
    scanRepo(db, { repoName: project, repoPath });
    const eventsCreated = detectEvents(db, { project, repoName: project, repoPath, previousHashes });

    const row = db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get(project) as { n: number };
    return { project, docsScanned: row.n, eventsCreated };
  });

  // p14-2: loops every configured project, running scanRepo + detection per
  // project inside its own try/catch — one project's read error (a bad
  // path, a permissions error, a malformed file) must not abort the loop
  // for the others; it's recorded as a failed result entry instead.
  app.post("/api/projects/scan-all", async () => {
    const results = listProjects(repos).map((project) => {
      const repoPath = repos[project];
      try {
        const previousHashes = snapshotDocIndexHashes(db, project);
        scanRepo(db, { repoName: project, repoPath });
        const eventsCreated = detectEvents(db, { project, repoName: project, repoPath, previousHashes });
        const row = db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get(project) as { n: number };
        return { project, ok: true as const, docsScanned: row.n, eventsCreated };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { project, ok: false as const, error };
      }
    });

    return { results };
  });
}
