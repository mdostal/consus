import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { listFilesAtRef, readDocContentAtRef, UnresolvableRefError } from "../adapters/doc-scanner/git-ref.js";
import { listProjects } from "../config/project-registry.js";
import { detectEvents } from "../events/detect.js";
import { parseDecisionPayload, serializeDecisionPayload } from "../decision-contract/parser.js";
import { classifyItem } from "../decision-contract/classifier.js";

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
 * s2-branch-scoped-decisions: ref-aware ingest counterpart to scanRepo/
 * detectEvents above. Walks `.pHive/planning/`/`.pHive/epics/**` as they
 * exist at `ref` (s1's listFilesAtRef/readDocContentAtRef, never fs/
 * scanRepo) and creates/updates a decision item for every decision-request
 * block found, tagging it with source_branch = ref. Deliberately does NOT
 * touch doc_index or events -- those stay the disk-based scan's concern; a
 * ref-aware ingest only needs to surface branch-scoped *decisions*, per the
 * story's scope. Reuses the exact same parseDecisionPayload/classifyItem
 * the disk-based detectDecisionNeededForRow path (server/events/detect.ts)
 * uses -- this changes *where content comes from*, not how it's interpreted
 * once read.
 *
 * Item ids are branch-scoped (`decision:<repo>:<ref>:<path>`), deliberately
 * distinct from the disk-based scan's `decision:<repo>:<path>` namespace
 * (server/events/detect.ts's decisionItemIdFor) -- a decision-request doc
 * that exists both on main and on a branch produces two distinct items, not
 * a merge/overwrite of one by the other (see the story's risks: this is
 * correct, not a bug -- a branch's decision may differ from main's by the
 * time it's reviewed).
 */
function ingestDecisionsAtRef(
  db: Database.Database,
  { repoName, repoPath, ref }: { repoName: string; repoPath: string; ref: string },
): { docsScanned: number; decisionsFound: number } {
  // listFilesAtRef resolves/validates ref before returning anything, so an
  // UnresolvableRefError here happens before any item is touched below --
  // there is no partial-write window for a bad ref.
  const files = listFilesAtRef(repoPath, ref);
  let decisionsFound = 0;

  for (const filePath of files) {
    const content = readDocContentAtRef(repoPath, ref, filePath);
    const payload = parseDecisionPayload(content);
    if (!payload) continue;

    const id = `decision:${repoName}:${ref}:${filePath}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO items (id, type, title, status, source_repo, source_branch, decision_payload, created_at, updated_at)
       VALUES (@id, 'decision', @title, 'active', @repo, @branch, @decision_payload, @now, @now)
       ON CONFLICT(id) DO UPDATE SET decision_payload = excluded.decision_payload, updated_at = excluded.updated_at`,
    ).run({
      id,
      title: payload.title,
      repo: repoName,
      branch: ref,
      decision_payload: serializeDecisionPayload(payload),
      now,
    });

    classifyItem(db, id);
    decisionsFound++;
  }

  return { docsScanned: files.length, decisionsFound };
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

  app.post<{ Params: { project: string }; Querystring: { ref?: string } }>(
    "/api/projects/:project/ingest",
    async (request, reply) => {
      const { project } = request.params;
      const { ref } = request.query ?? {};
      const repoPath = repos[project];
      if (!repoPath) {
        return reply.code(404).send({ error: `unknown project: ${project}` });
      }

      // s2-branch-scoped-decisions: a sibling ref-aware path on the same
      // route, gated on ?ref= being present. The unparameterized branch
      // below (no ref) is untouched by this addition.
      if (ref) {
        try {
          const { docsScanned, decisionsFound } = ingestDecisionsAtRef(db, { repoName: project, repoPath, ref });
          return { project, ref, docsScanned, decisionsFound };
        } catch (err) {
          if (err instanceof UnresolvableRefError) {
            return reply.code(400).send({ error: err.message });
          }
          throw err;
        }
      }

      const previousHashes = snapshotDocIndexHashes(db, project);
      scanRepo(db, { repoName: project, repoPath });
      const eventsCreated = detectEvents(db, { project, repoName: project, repoPath, previousHashes });

      const row = db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get(project) as { n: number };
      return { project, docsScanned: row.n, eventsCreated };
    },
  );

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
