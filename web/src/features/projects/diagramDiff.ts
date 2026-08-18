/**
 * The structured, typed changeset model fed by DiagramCanvas's edit events,
 * plus the diff-formatter that turns accumulated changes into the plain
 * `diff: string` field POST /api/proposals already expects (s2,
 * consus-phase18 — design-discussion.md resolved decision #3: rows are
 * typed added/removed/changed/moved, not a flat freeform log).
 */

export type DiagramChangeKind = "added" | "removed" | "changed" | "moved";
export type DiagramChangeEntity = "node" | "edge";

export interface DiagramChange {
  /** Unique per change event (not per entity — editing the same node twice
   *  produces two rows, an honest log of what actually happened). */
  id: string;
  kind: DiagramChangeKind;
  entity: DiagramChangeEntity;
  entityId: string;
  /** Human-readable subject for the row, e.g. a node's label or
   *  "Story One -> Story Two" for an edge. */
  label: string;
  /** Optional extra detail, e.g. `label changed from "Foo" to "Bar"` or
   *  `moved to (120, 340)`. */
  detail?: string;
}

let changeCounter = 0;

/** Builds a new change entry with a fresh id — the one place ids are
 *  minted, so callers never have to worry about collisions across the
 *  several kinds of edits DiagramCanvas can produce. */
export function createDiagramChange(input: Omit<DiagramChange, "id">): DiagramChange {
  changeCounter += 1;
  return { id: `dc-${changeCounter}-${Date.now()}`, ...input };
}

const KIND_PREFIX: Record<DiagramChangeKind, string> = {
  added: "+",
  removed: "-",
  changed: "~",
  moved: "^",
};

function formatLine(change: DiagramChange): string {
  const prefix = KIND_PREFIX[change.kind];
  const subject = `${change.entity} ${change.label}`;
  return change.detail ? `${prefix} ${subject}: ${change.detail}` : `${prefix} ${subject}`;
}

/**
 * Pure: turns the accumulated structured change list into a legible diff
 * string for POST /api/proposals's `diff` field — one line per change, in
 * the order the edits happened, so an operator or harness reading it can
 * reconstruct exactly what was added/removed/changed/moved without needing
 * the live graph state. Empty input yields an empty string (callers gate
 * "Fire to harness" on changes.length > 0, not on this being non-empty).
 */
export function formatDiagramDiff(changes: DiagramChange[]): string {
  return changes.map(formatLine).join("\n");
}
