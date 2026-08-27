import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import {
  listBranches,
  listFilesAtRef,
  readDocContentAtRef,
  UnresolvableRefError,
} from "../adapters/doc-scanner/git-ref.js";
import { listProjects, saveProjectRegistry } from "../config/project-registry.js";
import { detectEvents } from "../events/detect.js";
import { parseDecisionPayload, serializeDecisionPayload } from "../decision-contract/parser.js";
import { classifyItem } from "../decision-contract/classifier.js";

/** Project names double as URL path segments (`:project`) and as parts of
 *  item ids (`decision:<repo>:...`, `diagram:<repo>`) elsewhere in this
 *  codebase — restricted to a safe slug so a registered name can never
 *  collide with those conventions or need escaping. */
const VALID_PROJECT_NAME = /^[a-zA-Z0-9_-]+$/;

export interface ProjectRoutesOptions {
  db: Database.Database;
  /** repo name -> absolute path on disk, needed to resolve :project to a scan target */
  repos: Record<string, string>;
  /** Where the registry is persisted so a newly-added project survives a
   *  server restart. Defaults to the same path `loadProjectRegistry` reads
   *  from `CONSUS_PROJECTS_CONFIG` at startup (server/index.ts). */
  projectsConfigPath?: string;
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
export function registerProjectRoutes(
  app: FastifyInstance,
  { db, repos, projectsConfigPath = ".pHive/consus-projects.json" }: ProjectRoutesOptions,
): void {
  /**
   * s1 (consus-phase25-project-registration-ux): `paths` is additive
   * alongside `projects` — sourced from the same in-memory `repos` map
   * this route already has in scope, so ProjectsSection can show a
   * selected project's absolute repo path without a second round-trip.
   * A shallow copy, not a reference to `repos` itself, so a caller can't
   * mutate the live registry through the response body.
   */
  app.get("/api/projects", async () => {
    return { projects: listProjects(repos), paths: { ...repos } };
  });

  /**
   * Registers a new project — the missing counterpart to hand-editing
   * `.pHive/consus-projects.json`: names it, points it at a repo path on
   * disk, persists that to the config file so it survives a restart, and
   * immediately runs the same scan `POST /api/projects/:project/ingest`
   * does so the operator sees docs right away instead of an empty project.
   */
  app.post<{ Body: { name?: string; path?: string } }>("/api/projects", async (request, reply) => {
    const { name, path } = request.body ?? {};

    if (!name || !VALID_PROJECT_NAME.test(name)) {
      return reply
        .code(400)
        .send({ error: "name is required and may only contain letters, numbers, - and _" });
    }
    if (!path) {
      return reply.code(400).send({ error: "path is required" });
    }
    if (repos[name]) {
      return reply.code(409).send({ error: `project "${name}" is already registered` });
    }

    const repoPath = resolve(path);
    if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
      return reply.code(400).send({ error: `path does not exist or is not a directory: ${repoPath}` });
    }

    repos[name] = repoPath;
    saveProjectRegistry(projectsConfigPath, repos);

    const previousHashes = snapshotDocIndexHashes(db, name);
    scanRepo(db, { repoName: name, repoPath });
    const eventsCreated = detectEvents(db, { project: name, repoName: name, repoPath, previousHashes });
    const row = db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get(name) as { n: number };

    return reply.code(201).send({ project: name, path: repoPath, docsScanned: row.n, eventsCreated });
  });

  /**
   * s4 (consus-phase24-branch-level-surfacing): backs the web UI's branch
   * picker — lists local + remote-tracking branches (git-ref.ts's
   * listBranches, `git for-each-ref`) for a registered project, so the
   * operator can pick one to re-scope the decisions list / check a doc's
   * diff against. Never errors for a repo with no other branches yet
   * (listBranches itself degrades to `[]`) — only an unregistered project
   * 404s.
   */
  app.get<{ Params: { project: string } }>("/api/projects/:project/branches", async (request, reply) => {
    const { project } = request.params;
    const repoPath = repos[project];
    if (!repoPath) {
      return reply.code(404).send({ error: `unknown project: ${project}` });
    }

    return { branches: listBranches(repoPath) };
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
