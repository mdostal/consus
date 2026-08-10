import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { MulticaClient, MulticaEpic, MulticaStory } from "../../adapters/multica/client.js";

export interface CascadeStory {
  id: string;
  title: string;
  status: string | null;
  updatedAt: string | null;
  source: "disk" | "multica" | "merged";
}

export interface CascadeEpic {
  id: string;
  title: string;
  status: string | null;
  updatedAt: string | null;
  source: "disk" | "multica" | "merged";
  stories: CascadeStory[];
}

export interface CascadeTree {
  seed: { id: "seed"; title: string };
  meta: { id: "meta-orchestrator"; title: string };
  epics: CascadeEpic[];
}

export interface CascadeBuildResult {
  tree: CascadeTree;
  mermaidSource: string;
  stateSignature: string;
}

interface DiskRecord {
  id: string;
  title: string;
  status: string | null;
  updatedAt: string | null;
}

interface DiskEpic extends DiskRecord {
  stories: DiskRecord[];
}

export interface BuildCascadeTreeOptions {
  client: Pick<MulticaClient, "listEpics" | "listStories">;
  pHiveRoot: string;
  seedTitle?: string;
  metaTitle?: string;
}

function parseScalar(content: string, key: string): string | null {
  const pattern = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m");
  const match = content.match(pattern);
  if (!match) return null;
  const value = match[1].trim();
  if (!value || value === "null") return null;
  return value.replace(/^["']|["']$/g, "");
}

function listYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function readDiskRecord(filePath: string, fallbackId: string): DiskRecord {
  const content = readFileSync(filePath, "utf-8");
  const stats = statSync(filePath);
  const id = parseScalar(content, "id") ?? parseScalar(content, "name") ?? fallbackId;
  return {
    id,
    title: parseScalar(content, "title") ?? id,
    status: parseScalar(content, "status"),
    updatedAt: stats.mtime.toISOString(),
  };
}

export function readDiskEpics(pHiveRoot: string): DiskEpic[] {
  const epicsDir = path.join(pHiveRoot, ".pHive", "epics");
  if (!existsSync(epicsDir)) return [];

  return readdirSync(epicsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const epicDir = path.join(epicsDir, entry.name);
      const epicYaml = path.join(epicDir, "epic.yaml");
      const epic = existsSync(epicYaml)
        ? readDiskRecord(epicYaml, entry.name)
        : { id: entry.name, title: entry.name, status: null, updatedAt: null };
      const stories = listYamlFiles(path.join(epicDir, "stories")).map((storyFile) =>
        readDiskRecord(storyFile, path.basename(storyFile).replace(/\.ya?ml$/, "")),
      );
      return { ...epic, stories };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function mergeSource(a: "disk" | "multica" | "merged", b: "disk" | "multica" | "merged") {
  return a === b ? a : "merged";
}

function normalizeEpic(epic: MulticaEpic): CascadeEpic {
  return {
    id: epic.identifier ?? epic.id,
    title: epic.title,
    status: epic.status,
    updatedAt: epic.updatedAt,
    source: "multica",
    stories: [],
  };
}

function normalizeStory(story: MulticaStory): CascadeStory {
  return {
    id: story.identifier ?? story.id,
    title: story.title,
    status: story.status,
    updatedAt: story.updatedAt,
    source: "multica",
  };
}

function mergeStory(existing: CascadeStory | undefined, incoming: CascadeStory): CascadeStory {
  if (!existing) return incoming;
  return {
    id: existing.id,
    title: incoming.title || existing.title,
    status: incoming.status ?? existing.status,
    updatedAt: incoming.updatedAt ?? existing.updatedAt,
    source: mergeSource(existing.source, incoming.source),
  };
}

function mergeEpic(existing: CascadeEpic | undefined, incoming: CascadeEpic): CascadeEpic {
  if (!existing) return incoming;
  const stories = new Map(existing.stories.map((story) => [story.id, story]));
  for (const story of incoming.stories) {
    stories.set(story.id, mergeStory(stories.get(story.id), story));
  }
  return {
    id: existing.id,
    title: incoming.title || existing.title,
    status: incoming.status ?? existing.status,
    updatedAt: incoming.updatedAt ?? existing.updatedAt,
    source: mergeSource(existing.source, incoming.source),
    stories: [...stories.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function loadMulticaEpics(client: Pick<MulticaClient, "listEpics" | "listStories">): Promise<CascadeEpic[]> {
  const epicsResult = await client.listEpics();
  if (!epicsResult.ok) throw new Error(epicsResult.error);

  const epics: CascadeEpic[] = [];
  for (const epic of epicsResult.epics) {
    const storiesResult = await client.listStories(epic.id);
    if (!storiesResult.ok) throw new Error(storiesResult.error);
    epics.push({
      ...normalizeEpic(epic),
      stories: storiesResult.stories.map(normalizeStory).sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
  return epics;
}

export async function loadCascadeTree({
  client,
  pHiveRoot,
  seedTitle = "Seed",
  metaTitle = "Meta Orchestrator",
}: BuildCascadeTreeOptions): Promise<CascadeTree> {
  const epics = new Map<string, CascadeEpic>();

  for (const diskEpic of readDiskEpics(pHiveRoot)) {
    const incoming: CascadeEpic = {
      id: diskEpic.id,
      title: diskEpic.title,
      status: diskEpic.status,
      updatedAt: diskEpic.updatedAt,
      source: "disk",
      stories: diskEpic.stories.map((story) => ({ ...story, source: "disk" })),
    };
    epics.set(incoming.id, mergeEpic(epics.get(incoming.id), incoming));
  }

  for (const multicaEpic of await loadMulticaEpics(client)) {
    epics.set(multicaEpic.id, mergeEpic(epics.get(multicaEpic.id), multicaEpic));
  }

  return {
    seed: { id: "seed", title: seedTitle },
    meta: { id: "meta-orchestrator", title: metaTitle },
    epics: [...epics.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function mermaidSafeId(prefix: string, raw: string, used: Set<string>): string {
  const base = `${prefix}_${raw}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  let candidate = base || `${prefix}_node`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\[/g, "(").replace(/\]/g, ")");
}

function label(record: { id: string; title: string; status?: string | null }): string {
  const title = record.title === record.id ? record.title : `${record.id}: ${record.title}`;
  return record.status ? `${title} (${record.status})` : title;
}

export function generateCascadeMermaid(tree: CascadeTree): string {
  const used = new Set<string>();
  const seedId = mermaidSafeId("node", tree.seed.id, used);
  const metaId = mermaidSafeId("node", tree.meta.id, used);
  const lines = [
    "graph TD",
    `  ${seedId}["${escapeLabel(tree.seed.title)}"]`,
    `  ${metaId}["${escapeLabel(tree.meta.title)}"]`,
    `  ${seedId} --> ${metaId}`,
  ];

  for (const epic of tree.epics) {
    const epicId = mermaidSafeId("epic", epic.id, used);
    lines.push(`  ${epicId}["${escapeLabel(label(epic))}"]`);
    lines.push(`  ${metaId} --> ${epicId}`);

    for (const story of epic.stories) {
      const storyId = mermaidSafeId("story", `${epic.id}_${story.id}`, used);
      lines.push(`  ${storyId}["${escapeLabel(label(story))}"]`);
      lines.push(`  ${epicId} --> ${storyId}`);
    }
  }

  return lines.join("\n");
}

export function cascadeStateSignature(tree: CascadeTree): string {
  return createHash("sha256").update(JSON.stringify(tree)).digest("hex");
}

export async function buildCascadeTree(options: BuildCascadeTreeOptions): Promise<CascadeBuildResult> {
  const tree = await loadCascadeTree(options);
  return {
    tree,
    mermaidSource: generateCascadeMermaid(tree),
    stateSignature: cascadeStateSignature(tree),
  };
}
