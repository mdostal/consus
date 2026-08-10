import type Database from "better-sqlite3";
import { readdirSync } from "node:fs";
import { scanRepo, queryDocIndex } from "../../adapters/doc-scanner/index.js";

export type DiagramLevel = "top" | "full";

export interface ArchComponent {
  id: string;
  label: string;
}

export interface ArchEdge {
  from: string;
  to: string;
}

export interface ArchGraph {
  components: ArchComponent[];
  edges: ArchEdge[];
}

export interface BuildArchitectureOptions {
  db: Database.Database;
  repoName: string;
  repoPath: string;
  level: DiagramLevel;
}

const TOP_LEVEL_MAX_COMPONENTS = 10;
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".pHive",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "out",
  ".cache",
  ".vscode",
  ".idea",
]);
/** Fallback ordering when sequencing a full-level epic's phases into dependency edges. */
const PHASE_ORDER = ["planning", "design", "docs", "stories", "unphased"];

function phaseRank(phase: string): number {
  const idx = PHASE_ORDER.indexOf(phase);
  return idx === -1 ? PHASE_ORDER.length : idx;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_") || "root";
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "&quot;");
}

/** repo file-structure fallback per this story's risk mitigation: used when no .pHive docs are indexed for this repo. */
function fallbackTopLevelDirs(repoPath: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(repoPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !IGNORE_DIRS.has(entry.name) && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

function buildFallbackGraph(repoPath: string, level: DiagramLevel): ArchGraph {
  const dirs = fallbackTopLevelDirs(repoPath);
  const chosen = level === "top" ? dirs.slice(0, TOP_LEVEL_MAX_COMPONENTS) : dirs;
  return {
    components: chosen.map((d) => ({ id: sanitizeId(d), label: d })),
    edges: [],
  };
}

/** Generates the repo architecture graph by reading .pHive design docs (via the Doc Scanner), falling back to a repo directory scan when no docs are indexed. */
export function buildRepoArchitectureGraph({ db, repoName, repoPath, level }: BuildArchitectureOptions): ArchGraph {
  scanRepo(db, { repoName, repoPath });
  const rows = queryDocIndex(db, repoName);

  if (rows.length === 0) {
    return buildFallbackGraph(repoPath, level);
  }

  const epics = Array.from(new Set(rows.map((r) => r.epic ?? "unclassified"))).sort();

  if (level === "top") {
    const chosen = epics.slice(0, TOP_LEVEL_MAX_COMPONENTS);
    return {
      components: chosen.map((e) => ({ id: sanitizeId(e), label: e })),
      edges: [],
    };
  }

  const seen = new Map<string, ArchComponent>();
  for (const row of rows) {
    const epic = row.epic ?? "unclassified";
    const phase = row.phase ?? "unphased";
    const key = `${epic}::${phase}`;
    if (!seen.has(key)) {
      seen.set(key, { id: sanitizeId(key), label: `${epic} / ${phase}` });
    }
  }
  const components = Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));

  const edges: ArchEdge[] = [];
  for (const epic of epics) {
    const phasesInEpic = Array.from(
      new Set(rows.filter((r) => (r.epic ?? "unclassified") === epic).map((r) => r.phase ?? "unphased")),
    ).sort((a, b) => phaseRank(a) - phaseRank(b));
    for (let i = 0; i < phasesInEpic.length - 1; i++) {
      edges.push({
        from: sanitizeId(`${epic}::${phasesInEpic[i]}`),
        to: sanitizeId(`${epic}::${phasesInEpic[i + 1]}`),
      });
    }
  }

  return { components, edges };
}

/** Renders an architecture graph as `graph TD` Mermaid markup. */
export function renderArchitectureMermaid(graph: ArchGraph): string {
  const lines = ["graph TD"];
  for (const component of graph.components) {
    lines.push(`  ${component.id}["${escapeMermaidLabel(component.label)}"]`);
  }
  for (const edge of graph.edges) {
    lines.push(`  ${edge.from} --> ${edge.to}`);
  }
  return lines.join("\n");
}

/** Fingerprint of the repo's currently-indexed .pHive docs — changes iff any indexed doc's content changed. */
export function docsFingerprint(db: Database.Database, repoName: string): string {
  const rows = queryDocIndex(db, repoName);
  if (rows.length === 0) return "empty";
  return rows
    .map((r) => `${r.file_path}:${r.content_hash}`)
    .sort()
    .join("|");
}
