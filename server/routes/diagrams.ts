import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { generateArchitectureDiagrams } from "../lib/diagram-generator.js";

export interface DiagramRoutesOptions {
  db: Database.Database;
  /** repo name -> absolute path on disk (same registry docs/kb routes use) */
  repos: Record<string, string>;
}

/** The item id a diagram's propose-a-change proposals target (s4). One
 *  synthetic item per repo's diagram, not per epic/story node — "step one"
 *  per the operator's own scoping. */
export function diagramItemIdFor(repo: string): string {
  return `diagram:${repo}`;
}

interface DiagramStory {
  id: string;
  title: string;
  complexity: string | null;
  dependsOn: string[];
}

interface DiagramEpic {
  id: string;
  title: string;
  stories: DiagramStory[];
}

interface RawStoryRef {
  id?: unknown;
  title?: unknown;
  complexity?: unknown;
  depends_on?: unknown;
}

interface RawEpicYaml {
  name?: unknown;
  title?: unknown;
  stories?: unknown;
}

function readEpic(epicYamlPath: string): DiagramEpic | null {
  let raw: RawEpicYaml;
  try {
    raw = (parseYaml(readFileSync(epicYamlPath, "utf-8")) ?? {}) as RawEpicYaml;
  } catch {
    return null; // malformed epic.yaml — skip rather than 500 the whole tree
  }

  const id = typeof raw.name === "string" ? raw.name : null;
  if (!id) return null;

  const stories: DiagramStory[] = Array.isArray(raw.stories)
    ? (raw.stories as RawStoryRef[])
        .filter((s): s is RawStoryRef & { id: string } => typeof s?.id === "string")
        .map((s) => ({
          id: s.id,
          title: typeof s.title === "string" ? s.title : s.id,
          complexity: typeof s.complexity === "string" ? s.complexity : null,
          dependsOn: Array.isArray(s.depends_on) ? s.depends_on.filter((d): d is string => typeof d === "string") : [],
        }))
    : [];

  return { id, title: typeof raw.title === "string" ? raw.title : id, stories };
}

/**
 * Cascade org-tree: every epic in a repo's .pHive/epics/, each with its
 * stories and dependency edges — built entirely from this repo's own
 * planning YAML on disk. Read-only in this story; s4-diagram-viewer-and-
 * propose-ui adds the propose-a-change action via s3's dispatch mechanism.
 */
export function registerDiagramRoutes(app: FastifyInstance, { db, repos }: DiagramRoutesOptions): void {
  app.get<{ Querystring: { repo?: string } }>("/api/diagrams", async (request, reply) => {
    const { repo } = request.query;
    if (!repo) {
      return reply.code(400).send({ error: "repo query param is required" });
    }
    const repoPath = repos[repo];
    if (!repoPath) {
      return reply.code(404).send({ error: `unknown repo: ${repo}` });
    }

    // Ensure a target item exists for this repo's diagram before the caller
    // can propose a change to it (s3's proposeChange requires a real item
    // row) — upserted on every fetch so it's always ready by view time.
    const itemId = diagramItemIdFor(repo);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO items (id, type, title, status, source_repo, created_at, updated_at)
       VALUES (?, 'diagram', ?, 'active', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(itemId, `${repo} diagram`, repo, now, now);

    const epicsDir = join(repoPath, ".pHive", "epics");
    let epicDirs: string[];
    try {
      epicDirs = readdirSync(epicsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return { repo, itemId, epics: [] }; // no .pHive/epics yet — not an error
    }

    const epics = epicDirs
      .map((dir) => readEpic(join(epicsDir, dir, "epic.yaml")))
      .filter((e): e is DiagramEpic => e !== null)
      .sort((a, b) => a.id.localeCompare(b.id));

    return { repo, itemId, epics };
  });

  /**
   * A second, independent diagram kind: a real per-repo architecture diagram
   * derived from the repo's actual directory structure (not planning docs),
   * generated fresh on every request — no cache table, see this story's
   * design-discussion.md. Kept as a distinct path segment rather than a
   * query-param variant of the cascade endpoint above, so that endpoint's
   * contract, route registration, and tests stay untouched.
   */
  app.get<{ Params: { repo: string } }>("/api/diagrams/:repo/architecture", async (request, reply) => {
    const { repo } = request.params;
    const repoPath = repos[repo];
    if (!repoPath) {
      return reply.code(404).send({ error: `unknown repo: ${repo}` });
    }

    const { topLevel, fullComponent } = generateArchitectureDiagrams(repoPath);
    return { repo, topLevel, fullComponent };
  });
}
