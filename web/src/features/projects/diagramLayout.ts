/**
 * Pure node-layout logic shared by DiagramCanvas's two callers (the epic/
 * story cascade in DiagramView.tsx and the directory graph in
 * ArchitectureDiagramView.tsx) — s2, consus-phase18.
 *
 * This is the explicit regression guard called out in the story: the
 * exploratory mockup's real bug was diagram nodes overlapping and
 * truncating mid-label once a level had 6+ sibling nodes, because that
 * mockup's hand-rolled SVG positioning used a fixed per-node slot width
 * that longer labels could overflow into their neighbor. React Flow's own
 * default behavior is not automatically immune to the same mistake — it
 * still needs *something* to compute x/y for every node, and if that
 * something uses fixed slot widths, the same bug reproduces under a
 * different library.
 *
 * layoutByLevel fixes this at the source: every node's on-canvas width is
 * derived from its own label text (estimateNodeWidth), and siblings within
 * a level are placed strictly left-to-right, each one's x starting only
 * after the previous one's box (width included) plus a fixed gap — so two
 * sibling boxes can never overlap regardless of how many siblings share a
 * level or how long any one label is.
 */

export interface LayoutNodeInput {
  id: string;
  label: string;
  /** Row index — 0 is the top row, larger numbers render further down. */
  level: number;
  /** Optional grouping key so nodes from the same group land contiguously
   *  within their level (e.g. all of one epic's stories next to each
   *  other) — purely cosmetic ordering, never affects overlap safety. */
  groupOrder?: number;
}

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  width: number;
}

/** Rough average glyph width for the app's monospace/UI font stacks —
 *  deliberately generous (an overestimate is safe: it only ever widens
 *  gaps, never causes overlap; an underestimate could reintroduce the
 *  regression this module exists to prevent). */
const CHAR_WIDTH_PX = 7.5;
const NODE_HORIZONTAL_PADDING_PX = 28;
const MIN_NODE_WIDTH_PX = 96;
const MAX_NODE_WIDTH_PX = 320;
/** Minimum gap between two sibling nodes' boxes, regardless of width. */
const NODE_GAP_PX = 36;
const LEVEL_HEIGHT_PX = 140;

/** Pure: a node's on-canvas box width, derived from its own label text so
 *  no fixed slot size can ever be too small for what it actually renders
 *  (the mockup's regression, guarded against directly). */
export function estimateNodeWidth(label: string): number {
  const raw = label.length * CHAR_WIDTH_PX + NODE_HORIZONTAL_PADDING_PX;
  return Math.min(MAX_NODE_WIDTH_PX, Math.max(MIN_NODE_WIDTH_PX, Math.round(raw)));
}

/**
 * Pure: assigns every node an {x, y, width} such that no two nodes at the
 * same level ever overlap, however many siblings share that level. Levels
 * are laid out independently (each level's own left-to-right cursor), and
 * nodes are ordered first by groupOrder (default 0), then by input order,
 * so same-group siblings land next to each other.
 */
export function layoutByLevel(nodes: LayoutNodeInput[]): Map<string, PositionedNode> {
  const byLevel = new Map<number, LayoutNodeInput[]>();
  for (const node of nodes) {
    const list = byLevel.get(node.level) ?? [];
    list.push(node);
    byLevel.set(node.level, list);
  }

  const positions = new Map<string, PositionedNode>();
  for (const [level, rowNodes] of byLevel) {
    const ordered = rowNodes
      .map((node, index) => ({ node, index }))
      .sort((a, b) => (a.node.groupOrder ?? 0) - (b.node.groupOrder ?? 0) || a.index - b.index);

    let cursorX = 0;
    for (const { node } of ordered) {
      const width = estimateNodeWidth(node.label);
      positions.set(node.id, { id: node.id, x: cursorX, y: level * LEVEL_HEIGHT_PX, width });
      cursorX += width + NODE_GAP_PX;
    }
  }

  return positions;
}

/** True if two positioned nodes' horizontal boxes intersect. Used directly
 *  by the regression-guard test — the real assertion an overlap bug would
 *  trip, rather than an indirect proxy like "label text is present". */
export function boxesOverlap(a: PositionedNode, b: PositionedNode): boolean {
  if (a.y !== b.y) return false; // different rows never overlap in this layout
  const aEnd = a.x + a.width;
  const bEnd = b.x + b.width;
  return a.x < bEnd && b.x < aEnd;
}

/**
 * Pure: assigns every node a level (row) purely from graph structure — a
 * node with no incoming edge is a root (level 0); every other node's level
 * is one more than the shallowest of its parents' levels (BFS from every
 * root). Used by ArchitectureDiagramView.tsx, whose source data (a parsed
 * Mermaid `graph TD` string, see mermaidGraphParse.ts) has no explicit
 * level/depth concept the way DiagramView.tsx's epic/story tree already
 * does — this derives one so layoutByLevel above has something to lay out.
 * A node unreachable from any root (should not happen for
 * diagram-generator.ts's own output, but tolerated rather than trusted)
 * falls back to level 0.
 */
export function computeLevelsFromEdges(
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>,
): Map<string, number> {
  const hasIncoming = new Set(edges.map((e) => e.target));
  const childrenBySource = new Map<string, string[]>();
  for (const e of edges) {
    const list = childrenBySource.get(e.source) ?? [];
    list.push(e.target);
    childrenBySource.set(e.source, list);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const id of nodeIds) {
    if (!hasIncoming.has(id)) {
      levels.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current)!;
    for (const child of childrenBySource.get(current) ?? []) {
      const candidate = currentLevel + 1;
      if (levels.get(child) === undefined || candidate < levels.get(child)!) {
        levels.set(child, candidate);
        queue.push(child);
      }
    }
  }

  // Nodes never reached from a root (shouldn't happen for well-formed
  // input, but this function never throws on malformed input) default to 0.
  for (const id of nodeIds) {
    if (!levels.has(id)) levels.set(id, 0);
  }

  return levels;
}
