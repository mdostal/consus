import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import type { MulticaClient, MulticaIssue } from "../adapters/multica/client.js";

export type CascadeNodeKind = "seed" | "meta-orchestrator" | "epic" | "story" | "issue";
export type CascadeNodeSource = "multica" | "phive";

export interface CascadeNode {
  /** stable, mermaid-safe node id */
  id: string;
  label: string;
  kind: CascadeNodeKind;
  source: CascadeNodeSource;
  status?: string;
  children: CascadeNode[];
}

export interface EpicFileStory {
  id: string;
  title: string;
}

export interface EpicFile {
  repo: string;
  name: string;
  title: string;
  stories: EpicFileStory[];
}

/** Minimal shape the cascade builder needs from a Multica issue. */
export interface CascadeIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  parentId: string | null;
}

const SEED_RE = /\bseed\b/i;
const META_ORCHESTRATOR_RE = /meta[-\s]?orchestrator/i;
const SLICE_EPIC_RE = /^\[?slice-\d+/i;

/**
 * Title-based heuristic classification — Multica doesn't carry an explicit
 * "epic vs story" issue type, so the cascade (seed -> meta-orchestrator ->
 * slice epics -> stories) is inferred from the conventional title tags used
 * across the Pantheon workspace (see PAN-7947's description).
 */
export function classifyKind(title: string): CascadeNodeKind {
  if (SEED_RE.test(title)) return "seed";
  if (META_ORCHESTRATOR_RE.test(title)) return "meta-orchestrator";
  if (SLICE_EPIC_RE.test(title)) return "epic";
  return "issue";
}

function toCascadeIssue(issue: MulticaIssue): CascadeIssue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    status: issue.status,
    parentId: issue.parentId,
  };
}

function issueLabel(issue: CascadeIssue): string {
  return issue.identifier ? `${issue.identifier}: ${issue.title}` : issue.title;
}

/**
 * Builds a forest from a flat list of Multica issues using parent_issue_id
 * links. A node under a seed/meta-orchestrator/epic parent is promoted from
 * the generic "issue" kind to "story" — it has no title convention of its
 * own, its position in the tree is what marks it as a story.
 */
export function buildMulticaForest(issues: CascadeIssue[]): CascadeNode[] {
  const nodes = new Map<string, CascadeNode>();
  for (const issue of issues) {
    nodes.set(issue.id, {
      id: issue.id,
      label: issueLabel(issue),
      kind: classifyKind(issue.title),
      source: "multica",
      status: issue.status,
      children: [],
    });
  }

  const roots: CascadeNode[] = [];
  const byParentKind: CascadeNodeKind[] = ["seed", "meta-orchestrator", "epic"];
  for (const issue of issues) {
    const node = nodes.get(issue.id)!;
    const parent = issue.parentId ? nodes.get(issue.parentId) : undefined;
    if (parent) {
      if (node.kind === "issue" && byParentKind.includes(parent.kind)) {
        node.kind = "story";
      }
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortByLabel = (a: CascadeNode, b: CascadeNode) => a.label.localeCompare(b.label);
  for (const node of nodes.values()) node.children.sort(sortByLabel);
  roots.sort(sortByLabel);

  return roots;
}

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[[\]]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when an epic.yaml's name/title plausibly refers to the same epic as a cascade node's label. */
function epicMatchesNode(epicFile: EpicFile, node: CascadeNode): boolean {
  const nodeSlug = normalizeSlug(node.label);
  const nameSlug = normalizeSlug(epicFile.name);
  const titleSlug = normalizeSlug(epicFile.title);
  return (
    (nameSlug.length > 0 && nodeSlug.includes(nameSlug)) ||
    (titleSlug.length > 0 && nodeSlug.includes(titleSlug))
  );
}

function hasMatchingChild(node: CascadeNode, story: EpicFileStory): boolean {
  const storySlug = normalizeSlug(story.id);
  return node.children.some((child) => normalizeSlug(child.label).includes(storySlug));
}

/**
 * Supplements each epic node's Multica-sourced children with any on-disk
 * .pHive/epics/*\/epic.yaml stories not already represented as a Multica
 * sub-issue — Multica is the source of truth where both exist (design
 * decision in this story's plan), disk only fills gaps.
 */
export function mergeEpicFilesIntoForest(forest: CascadeNode[], epicFiles: EpicFile[]): CascadeNode[] {
  const visit = (node: CascadeNode) => {
    if (node.kind === "epic" || node.kind === "seed" || node.kind === "meta-orchestrator") {
      for (const epicFile of epicFiles) {
        if (!epicMatchesNode(epicFile, node)) continue;
        for (const story of epicFile.stories) {
          if (hasMatchingChild(node, story)) continue;
          node.children.push({
            id: `phive:${epicFile.repo}:${epicFile.name}:${story.id}`,
            label: story.title,
            kind: "story",
            source: "phive",
            children: [],
          });
        }
      }
      node.children.sort((a, b) => a.label.localeCompare(b.label));
    }
    for (const child of node.children) visit(child);
  };
  for (const root of forest) visit(root);
  return forest;
}

/** Parses one .pHive/epics/<name>/epic.yaml file's `name`, `title`, and `stories[].{id,title}`. */
export function parseEpicYaml(raw: string, repo: string): EpicFile | null {
  let doc: unknown;
  try {
    doc = loadYaml(raw);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const record = doc as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : null;
  if (!name) return null;
  const title = typeof record.title === "string" ? record.title : name;

  const rawStories = Array.isArray(record.stories) ? record.stories : [];
  const stories: EpicFileStory[] = rawStories
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      id: typeof s.id === "string" ? s.id : "",
      title: typeof s.title === "string" ? s.title : typeof s.id === "string" ? s.id : "",
    }))
    .filter((s) => s.id.length > 0);

  return { repo, name, title, stories };
}

/** Finds every .pHive/epics/*\/epic.yaml under a repo's absolute path. */
export function findEpicYamlPaths(repoPath: string): string[] {
  const epicsDir = join(repoPath, ".pHive", "epics");
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(epicsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(epicsDir, entry.name, "epic.yaml"))
    .filter((path) => {
      try {
        readFileSync(path);
        return true;
      } catch {
        return false;
      }
    });
}

/** Reads and parses every on-disk epic.yaml across the given repos (name -> absolute path). */
export function loadEpicFiles(repos: Record<string, string>): EpicFile[] {
  const files: EpicFile[] = [];
  for (const [repoName, repoPath] of Object.entries(repos)) {
    for (const epicYamlPath of findEpicYamlPaths(repoPath)) {
      const raw = readFileSync(epicYamlPath, "utf-8");
      const parsed = parseEpicYaml(raw, repoName);
      if (parsed) files.push(parsed);
    }
  }
  return files;
}

export interface BuildCascadeTreeOptions {
  client: MulticaClient;
  /** repo name -> absolute path on disk, scanned for .pHive/epics/*\/epic.yaml */
  repos: Record<string, string>;
}

export type BuildCascadeTreeResult =
  | { ok: true; forest: CascadeNode[] }
  | { ok: false; error: string };

/** Fetches the live Multica issue set, builds the seed->meta-orchestrator->epics->stories forest, and merges in on-disk epic.yaml stories. */
export async function buildCascadeTree({ client, repos }: BuildCascadeTreeOptions): Promise<BuildCascadeTreeResult> {
  const listed = await client.listIssues({});
  if (!listed.ok) {
    return { ok: false, error: listed.error };
  }

  const forest = buildMulticaForest(listed.issues.map(toCascadeIssue));
  const epicFiles = loadEpicFiles(repos);
  mergeEpicFilesIntoForest(forest, epicFiles);

  return { ok: true, forest };
}

let mermaidIdCounter = 0;

function sanitizeMermaidId(id: string): string {
  return `n${mermaidIdCounter++}_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "&quot;");
}

/** Renders a cascade forest as `graph LR` Mermaid markup. */
export function renderCascadeMermaid(forest: CascadeNode[]): string {
  mermaidIdCounter = 0;
  const lines = ["graph LR"];
  const idFor = new Map<CascadeNode, string>();

  const declare = (node: CascadeNode) => {
    const mermaidId = sanitizeMermaidId(node.id);
    idFor.set(node, mermaidId);
    lines.push(`  ${mermaidId}["${escapeMermaidLabel(node.label)}"]`);
    for (const child of node.children) declare(child);
  };
  for (const root of forest) declare(root);

  const link = (node: CascadeNode) => {
    for (const child of node.children) {
      lines.push(`  ${idFor.get(node)} --> ${idFor.get(child)}`);
      link(child);
    }
  };
  for (const root of forest) link(root);

  return lines.join("\n");
}
