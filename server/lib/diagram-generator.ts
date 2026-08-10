import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

export interface DiagramResult {
  topLevel: string;
  fullComponent: string;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-server",
  "build",
  "coverage",
  ".git",
  ".pHive",
  ".vite",
  ".turbo",
]);

/** Risk mitigation (design doc): large repos can generate huge diagrams — cap total nodes. */
const MAX_COMPONENTS = 50;

function sanitizeId(value: string): string {
  const id = value.replace(/[^a-zA-Z0-9_]/g, "_");
  return id.length > 0 ? id : "node";
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, "'");
}

function listDirs(dir: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !IGNORED_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function buildTopLevelGraph(repoPath: string): string {
  const rootLabel = escapeLabel(basename(repoPath) || "repo");
  const lines = ["graph TD", `  root["${rootLabel}"]`];
  for (const dir of listDirs(repoPath).slice(0, MAX_COMPONENTS)) {
    const id = sanitizeId(dir);
    lines.push(`  root --> ${id}["${escapeLabel(dir)}"]`);
  }
  return lines.join("\n");
}

interface ComponentGraph {
  lines: string[];
  nodeIds: Set<string>;
  count: number;
}

function addNode(graph: ComponentGraph, id: string, label: string): void {
  if (graph.nodeIds.has(id)) return;
  graph.nodeIds.add(id);
  graph.lines.push(`  ${id}["${escapeLabel(label)}"]`);
}

function addEdge(graph: ComponentGraph, fromId: string, toId: string): void {
  graph.lines.push(`  ${fromId} --> ${toId}`);
}

/** Depth-2 directory walk, capped at MAX_COMPONENTS total nodes (root excluded). */
function walkComponents(graph: ComponentGraph, dir: string, parentId: string, relPath: string, depth: number): void {
  if (graph.count >= MAX_COMPONENTS || depth > 2) return;
  for (const name of listDirs(dir)) {
    if (graph.count >= MAX_COMPONENTS) return;
    const childRel = relPath ? `${relPath}/${name}` : name;
    const childId = sanitizeId(childRel);
    addNode(graph, childId, name);
    addEdge(graph, parentId, childId);
    graph.count += 1;
    walkComponents(graph, join(dir, name), childId, childRel, depth + 1);
  }
}

/**
 * Tolerant reader (design doc risk mitigation): a malformed/missing
 * design-discussion.md is skipped with a warning, never a thrown error.
 */
function findDesignDiscussionDocs(repoPath: string): string[] {
  const epicsDir = join(repoPath, ".pHive", "epics");
  let epicNames: string[];
  try {
    epicNames = readdirSync(epicsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return epicNames
    .map((epic) => join(epicsDir, epic, "docs", "design-discussion.md"))
    .filter((docPath) => existsSync(docPath));
}

/** Pulls file-path-shaped inline code spans (e.g. `server/adapters/foo.ts`) out of a design doc as component mentions. */
function extractComponentMentions(content: string): string[] {
  const mentions = new Set<string>();
  const codeSpanPattern = /`([^`\n]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = codeSpanPattern.exec(content)) !== null) {
    const text = match[1].trim();
    if (/^[\w.-]+(\/[\w.-]+)+$/.test(text)) {
      mentions.add(text);
    }
  }
  return Array.from(mentions);
}

function collectDesignMentions(repoPath: string): string[] {
  const mentions = new Set<string>();
  for (const docPath of findDesignDiscussionDocs(repoPath)) {
    try {
      const content = readFileSync(docPath, "utf-8");
      for (const mention of extractComponentMentions(content)) {
        mentions.add(mention);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[diagram-generator] failed to parse ${docPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return Array.from(mentions);
}

function buildFullComponentGraph(repoPath: string, mentions: string[]): string {
  const graph: ComponentGraph = { lines: ["graph TD"], nodeIds: new Set(), count: 0 };
  addNode(graph, "root", basename(repoPath) || "repo");
  walkComponents(graph, repoPath, "root", "", 0);

  for (const mention of mentions) {
    if (graph.count >= MAX_COMPONENTS) break;
    const id = sanitizeId(mention);
    if (graph.nodeIds.has(id)) continue;
    addNode(graph, id, mention);
    addEdge(graph, "root", id);
    graph.count += 1;
  }

  return graph.lines.join("\n");
}

/** Scans a repo's file structure and .pHive design docs to produce top-level and full-component Mermaid architecture diagrams. */
export function generateDiagrams(repoPath: string): DiagramResult {
  const topLevel = buildTopLevelGraph(repoPath);
  const mentions = collectDesignMentions(repoPath);
  const fullComponent = buildFullComponentGraph(repoPath, mentions);
  return { topLevel, fullComponent };
}
