/**
 * PANT-964: a dependency-free Mermaid flowchart -> SVG renderer, so exported
 * diagrams (.svg) and exported HTML (diagram embeds and ```mermaid blocks in
 * docs) render standalone — no mermaid.js, no CDN, no network.
 *
 * Deliberately narrow: it understands the flowchart subset Consus itself
 * emits (diagram-generator.ts's architecture graphs, the cascade's
 * buildMermaidSource with subgraphs) plus the common hand-written shapes:
 *
 *   graph|flowchart TD|TB|LR
 *   id["label"]   id[label]   id(label)   id{label}
 *   a --> b   a --- b   a -.-> b   a ==> b   a -->|label| b   a --> b --> c
 *   subgraph id["label"] ... end
 *
 * Anything else (other diagram types, styling directives) is ignored, and a
 * source with no flowchart header returns null so callers can fall back to
 * showing the raw source instead of a wrong picture.
 */

export interface FlowNode {
  id: string;
  label: string;
  /** Index of the subgraph this node was declared in, if any. */
  group: number | null;
}

export interface FlowEdge {
  source: string;
  target: string;
  label: string | null;
}

export interface Flowchart {
  direction: "TD" | "LR";
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: string[];
}

const HEADER_RE = /^(?:graph|flowchart)\s+(TD|TB|LR|BT|RL)\b/i;
const ARROW_RE = /\s*(?:-->|---|-\.->|==>)(?:\|([^|]*)\|)?\s*/;
const NODE_RE = /^([\w-]+)\s*(?:\[\[?|\(\(?|\{)\s*"?(.*?)"?\s*(?:\]\]?|\)\)?|\})$/;
const BARE_ID_RE = /^[\w-]+$/;
const SUBGRAPH_RE = /^subgraph\s+(.+)$/;

function decodeLabel(label: string): string {
  return label
    .replace(/&quot;/g, '"')
    .replace(/<br\s*\/?>/gi, " ")
    .trim();
}

export function parseFlowchart(source: string): Flowchart | null {
  const lines = source.split(/\r?\n/).map((l) => l.trim().replace(/;$/, ""));
  const headerIndex = lines.findIndex((l) => l && !l.startsWith("%%"));
  const header = headerIndex >= 0 ? HEADER_RE.exec(lines[headerIndex]) : null;
  if (!header) return null;

  const dir = header[1].toUpperCase();
  const direction: Flowchart["direction"] = dir === "LR" || dir === "RL" ? "LR" : "TD";
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const groups: string[] = [];
  const groupStack: number[] = [];

  const ensureNode = (ref: string): string | null => {
    const decl = NODE_RE.exec(ref);
    const id = decl ? decl[1] : BARE_ID_RE.test(ref) ? ref : null;
    if (!id) return null;
    const group = groupStack.length ? groupStack[groupStack.length - 1] : null;
    const existing = nodes.get(id);
    if (!existing) {
      nodes.set(id, { id, label: decl ? decodeLabel(decl[2]) : id, group });
    } else if (decl) {
      existing.label = decodeLabel(decl[2]);
      existing.group ??= group;
    }
    return id;
  };

  for (const line of lines.slice(headerIndex + 1)) {
    if (!line || line.startsWith("%%")) continue;

    const sub = SUBGRAPH_RE.exec(line);
    if (sub) {
      const decl = NODE_RE.exec(sub[1]);
      groups.push(decl ? decodeLabel(decl[2]) : decodeLabel(sub[1]));
      groupStack.push(groups.length - 1);
      continue;
    }
    if (line === "end") {
      groupStack.pop();
      continue;
    }

    // Split an edge chain into node refs and the labels between them. With a
    // capture group, String.split interleaves the captured |label| values.
    const parts = line.split(new RegExp(ARROW_RE.source));
    if (parts.length >= 3) {
      let previous = ensureNode(parts[0].trim());
      for (let i = 1; i + 1 < parts.length; i += 2) {
        const label = parts[i] !== undefined ? decodeLabel(parts[i]) : null;
        const next = ensureNode(parts[i + 1].trim());
        if (previous && next) edges.push({ source: previous, target: next, label: label || null });
        previous = next;
      }
      continue;
    }

    ensureNode(line); // a node declaration, or an ignored directive
  }

  return { direction, nodes: Array.from(nodes.values()), edges, groups };
}

/* ------------------------------ layout ------------------------------ */

const CHAR_WIDTH_PX = 7.5;
const NODE_PADDING_PX = 28;
const MIN_NODE_WIDTH_PX = 96;
const MAX_NODE_WIDTH_PX = 320;
const NODE_HEIGHT_PX = 40;
const GAP_PX = 36;
const LEVEL_GAP_PX = 70;
const MARGIN_PX = 20;
const GROUP_COLORS = ["#e0ecff", "#e3f5e1", "#fff1d6", "#f6e0f5", "#e0f5f5", "#f5e6e0"];

interface Box {
  x: number;
  y: number;
  width: number;
  label: string;
}

function nodeWidth(label: string): number {
  const raw = label.length * CHAR_WIDTH_PX + NODE_PADDING_PX;
  return Math.min(MAX_NODE_WIDTH_PX, Math.max(MIN_NODE_WIDTH_PX, Math.round(raw)));
}

function fitLabel(label: string, width: number): string {
  const maxChars = Math.floor((width - NODE_PADDING_PX) / CHAR_WIDTH_PX);
  return label.length <= maxChars ? label : `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Level = shortest distance from a root (a node with no incoming edge);
 *  nodes on a pure cycle fall back to level 0. */
function levelsFor(chart: Flowchart): Map<string, number> {
  const incoming = new Set(chart.edges.map((e) => e.target));
  const children = new Map<string, string[]>();
  for (const e of chart.edges) children.set(e.source, [...(children.get(e.source) ?? []), e.target]);

  const levels = new Map<string, number>();
  const queue = chart.nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  for (const id of queue) levels.set(id, 0);
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (!levels.has(child)) {
        levels.set(child, levels.get(current)! + 1);
        queue.push(child);
      }
    }
  }
  for (const n of chart.nodes) if (!levels.has(n.id)) levels.set(n.id, 0);
  return levels;
}

function layout(chart: Flowchart): { boxes: Map<string, Box>; width: number; height: number } {
  const levels = levelsFor(chart);
  const byLevel = new Map<number, FlowNode[]>();
  for (const node of chart.nodes) {
    const level = levels.get(node.id)!;
    byLevel.set(level, [...(byLevel.get(level) ?? []), node]);
  }
  const ordered = Array.from(byLevel.keys()).sort((a, b) => a - b);

  const boxes = new Map<string, Box>();
  let width = 0;
  let height = 0;
  let levelOffset = MARGIN_PX;
  for (const level of ordered) {
    // Same-group siblings land next to each other; input order otherwise.
    const row = byLevel.get(level)!.slice().sort((a, b) => (a.group ?? -1) - (b.group ?? -1));
    let cursor = MARGIN_PX;
    let levelExtent = NODE_HEIGHT_PX;
    for (const node of row) {
      const w = nodeWidth(node.label);
      if (chart.direction === "TD") {
        boxes.set(node.id, { x: cursor, y: levelOffset, width: w, label: node.label });
        cursor += w + GAP_PX;
      } else {
        boxes.set(node.id, { x: levelOffset, y: cursor, width: w, label: node.label });
        cursor += NODE_HEIGHT_PX + GAP_PX / 2;
        levelExtent = Math.max(levelExtent, w);
      }
    }
    const crossExtent = cursor - (chart.direction === "TD" ? GAP_PX : GAP_PX / 2) + MARGIN_PX;
    if (chart.direction === "TD") {
      width = Math.max(width, crossExtent);
      levelOffset += NODE_HEIGHT_PX + LEVEL_GAP_PX;
      height = levelOffset - LEVEL_GAP_PX + MARGIN_PX;
    } else {
      height = Math.max(height, crossExtent);
      levelOffset += levelExtent + LEVEL_GAP_PX;
      width = levelOffset - LEVEL_GAP_PX + MARGIN_PX;
    }
  }
  return { boxes, width: Math.max(width, 2 * MARGIN_PX), height: Math.max(height, 2 * MARGIN_PX) };
}

/* ------------------------------ render ------------------------------ */

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderFlowchartSvg(chart: Flowchart, title?: string): string {
  const { boxes, width, height } = layout(chart);
  const legendHeight = chart.groups.length ? 24 : 0;
  const totalHeight = height + legendHeight;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" width="${width}" height="${totalHeight}" role="img" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13">`,
  ];
  if (title) out.push(`<title>${escapeXml(title)}</title>`);
  out.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#555"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
  );

  for (const edge of chart.edges) {
    const a = boxes.get(edge.source);
    const b = boxes.get(edge.target);
    if (!a || !b) continue;
    const [x1, y1, x2, y2] =
      chart.direction === "TD"
        ? [a.x + a.width / 2, a.y + NODE_HEIGHT_PX, b.x + b.width / 2, b.y]
        : [a.x + a.width, a.y + NODE_HEIGHT_PX / 2, b.x, b.y + NODE_HEIGHT_PX / 2];
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#555" stroke-width="1.5" marker-end="url(#arrow)"/>`);
    if (edge.label) {
      out.push(
        `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" text-anchor="middle" fill="#333" font-size="11">${escapeXml(edge.label)}</text>`,
      );
    }
  }

  for (const node of chart.nodes) {
    const box = boxes.get(node.id)!;
    const fill = node.group === null ? "#f4f4f5" : GROUP_COLORS[node.group % GROUP_COLORS.length];
    out.push(
      `<g data-node-id="${escapeXml(node.id)}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${NODE_HEIGHT_PX}" rx="6" fill="${fill}" stroke="#71717a"/>` +
        `<text x="${box.x + box.width / 2}" y="${box.y + NODE_HEIGHT_PX / 2 + 4}" text-anchor="middle" fill="#18181b">${escapeXml(fitLabel(box.label, box.width))}</text></g>`,
    );
  }

  // Subgraphs are shown as a color legend rather than enclosing boxes: the
  // level layout doesn't keep a group's members contiguous across levels,
  // so a bounding box could overlap other groups' nodes.
  let legendX = MARGIN_PX;
  chart.groups.forEach((group, index) => {
    const y = height + 4;
    out.push(
      `<rect x="${legendX}" y="${y}" width="12" height="12" fill="${GROUP_COLORS[index % GROUP_COLORS.length]}" stroke="#71717a"/>` +
        `<text x="${legendX + 16}" y="${y + 10}" fill="#18181b" font-size="11">${escapeXml(group)}</text>`,
    );
    legendX += 16 + group.length * 6.5 + 16;
  });

  out.push("</svg>");
  return out.join("\n");
}

/** Mermaid source -> standalone SVG, or null when the source isn't a
 *  flowchart this renderer understands. */
export function mermaidToSvg(source: string, title?: string): string | null {
  const chart = parseFlowchart(source);
  return chart ? renderFlowchartSvg(chart, title) : null;
}
