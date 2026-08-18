/**
 * Parses the `graph TD` Mermaid source GET /api/diagrams/:repo/architecture
 * returns ({ topLevel, fullComponent }, server/lib/diagram-generator.ts)
 * into plain nodes/edges — the one structured-data gap the architecture
 * diagram has that the epic/story cascade doesn't (DiagramView.tsx builds
 * its graph straight from the typed DiagramEpic[] response, no text parsing
 * needed). Deliberately narrow: this only understands the exact subset of
 * Mermaid syntax diagram-generator.ts actually emits —
 *
 *   graph TD
 *   id["label"]
 *   fromId --> toId["label"]
 *   fromId --> toId
 *
 * — not general Mermaid syntax (no subgraphs, no other arrow styles). The
 * cascade's own richer syntax (subgraphs) never needs to round-trip through
 * this parser since DiagramView.tsx never parses text in either direction.
 */

export interface ParsedGraphNode {
  id: string;
  label: string;
}

export interface ParsedGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface ParsedGraph {
  nodes: ParsedGraphNode[];
  edges: ParsedGraphEdge[];
}

const HEADER_RE = /^graph\s+(TD|LR)$/i;
const EDGE_WITH_LABEL_RE = /^(\w+)\s*-->\s*(\w+)\["([^"]*)"\]$/;
const PLAIN_EDGE_RE = /^(\w+)\s*-->\s*(\w+)$/;
const NODE_DECL_RE = /^(\w+)\["([^"]*)"\]$/;

export function parseMermaidGraph(source: string): ParsedGraph {
  const nodeLabels = new Map<string, string>();
  const edges: ParsedGraphEdge[] = [];
  let edgeCounter = 0;

  // Tolerant reader (mirrors diagram-generator.ts's own posture on the
  // write side): a missing/non-string source — e.g. a still-loading or
  // malformed API response — yields an empty graph rather than throwing
  // and crashing the whole view.
  if (typeof source !== "string") {
    return { nodes: [], edges: [] };
  }

  const ensureNode = (id: string, label?: string) => {
    if (label !== undefined) {
      nodeLabels.set(id, label);
    } else if (!nodeLabels.has(id)) {
      nodeLabels.set(id, id);
    }
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line || HEADER_RE.test(line)) continue;

    let match = EDGE_WITH_LABEL_RE.exec(line);
    if (match) {
      const [, from, to, label] = match;
      ensureNode(from);
      ensureNode(to, label);
      edges.push({ id: `e${edgeCounter++}`, source: from, target: to });
      continue;
    }

    match = PLAIN_EDGE_RE.exec(line);
    if (match) {
      const [, from, to] = match;
      ensureNode(from);
      ensureNode(to);
      edges.push({ id: `e${edgeCounter++}`, source: from, target: to });
      continue;
    }

    match = NODE_DECL_RE.exec(line);
    if (match) {
      const [, id, label] = match;
      ensureNode(id, label);
      continue;
    }

    // Anything else (blank lines already skipped, unrecognized syntax) is
    // tolerantly ignored rather than thrown — mirrors diagram-generator.ts's
    // own tolerant-reader posture on the write side.
  }

  return {
    nodes: Array.from(nodeLabels.entries()).map(([id, label]) => ({ id, label })),
    edges,
  };
}
