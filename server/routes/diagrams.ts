import type { FastifyInstance } from "fastify";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

export interface DiagramRoutesOptions {
  /** repo name -> absolute path on disk (same registry docs/kb routes use) */
  repos: Record<string, string>;
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
 * stories and dependency edges — the reference shape is hive's
 * routes/diagrams.ts cascade endpoint (PAN-7956), scoped down to what's
 * buildable from this repo's own planning YAML on disk (no cross-project
 * Multica issue hierarchy — that's hive's cascade, not this one). Read-only
 * in this story; s4-diagram-viewer-and-propose-ui adds the propose-a-change
 * action via s3's dispatch mechanism.
 */
export function registerDiagramRoutes(app: FastifyInstance, { repos }: DiagramRoutesOptions): void {
  app.get<{ Querystring: { repo?: string } }>("/api/diagrams", async (request, reply) => {
    const { repo } = request.query;
    if (!repo) {
      return reply.code(400).send({ error: "repo query param is required" });
    }
    const repoPath = repos[repo];
    if (!repoPath) {
      return reply.code(404).send({ error: `unknown repo: ${repo}` });
    }

    const epicsDir = join(repoPath, ".pHive", "epics");
    let epicDirs: string[];
    try {
      epicDirs = readdirSync(epicsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return { repo, epics: [] }; // no .pHive/epics yet — not an error
    }

    const epics = epicDirs
      .map((dir) => readEpic(join(epicsDir, dir, "epic.yaml")))
      .filter((e): e is DiagramEpic => e !== null)
      .sort((a, b) => a.id.localeCompare(b.id));

    return { repo, epics };
  });
}
