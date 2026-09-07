/**
 * consus-phase28/s2: the one shared visual-diff renderer for the whole app.
 *
 * Both the docs flow (DocRenderer.tsx, via computeLineDiff) and the diagram
 * flow (DiagramChangeset.tsx, via the structured DiagramChange[] changeset)
 * already COMPUTE a diff purely to embed in the POST /api/proposals `diff`
 * string — neither ever rendered one visually before this story. This
 * component is the single place that visual language lives, so the two
 * flows can never drift into divergent styling: a doc's added line and a
 * diagram's added node use the exact same green row, same "+" glyph, same
 * CSS classes.
 *
 * Deliberately generic: `VisualDiffEntry` covers both a unified line-diff
 * (kind "add" | "remove" | "context", one row per line) and a structured
 * changeset (kind "add" | "remove" | "change" | "move", one row per
 * add/remove/rename/move event) — see parseLineDiff below for the doc-side
 * adapter; DiagramChangeset.tsx has its own small adapter for the
 * diagram-side DiagramChange[] shape.
 */

export type VisualDiffKind = "add" | "remove" | "change" | "move" | "context";

export interface VisualDiffEntry {
  /** Stable React key — a line index for line-diffs, or the originating
   *  DiagramChange's own id for changeset entries. */
  id: string;
  kind: VisualDiffKind;
  /** The row's main text — a line of content (doc diff) or a subject like
   *  "node Story One" (diagram changeset). */
  label: string;
  /** Optional secondary text, e.g. a diagram change's "moved to (120, 340)". */
  detail?: string;
}

export interface VisualDiffProps {
  entries: VisualDiffEntry[];
  /** Shown instead of the row list when entries is empty — e.g. "Two
   *  identical documents" for docs, "No pending changes yet." for diagrams.
   *  Never render a blank/broken diff for an empty entries array. */
  emptyMessage?: string;
}

const KIND_GLYPH: Record<VisualDiffKind, string> = {
  add: "+",
  remove: "−", // minus sign — visually distinct from a hyphen in most UI fonts
  change: "~",
  move: "↑", // up arrow, echoes "moved"
  context: " ",
};

const KIND_LABEL: Record<VisualDiffKind, string> = {
  add: "Added",
  remove: "Removed",
  change: "Changed",
  move: "Moved",
  context: "",
};

/**
 * Parses computeLineDiff's raw output (web/src/features/docs/textDiff.ts —
 * lines prefixed "  " for context, "- " for removed, "+ " for added) into
 * VisualDiffEntry[]. The one doc-side adapter into this shared component;
 * kept here (not in textDiff.ts) since it's purely a rendering concern —
 * textDiff.ts's output format is unchanged and still used as-is for the
 * POST /api/proposals `diff` field.
 */
export function parseLineDiff(diff: string): VisualDiffEntry[] {
  if (!diff) return [];
  return diff.split("\n").map((line, index) => {
    const id = `line-${index}`;
    if (line.startsWith("+ ")) return { id, kind: "add", label: line.slice(2) };
    if (line.startsWith("- ")) return { id, kind: "remove", label: line.slice(2) };
    if (line.startsWith("  ")) return { id, kind: "context", label: line.slice(2) };
    // Defensive fallback — computeLineDiff always emits one of the three
    // prefixes above, but an unrecognized line is still rendered rather
    // than silently dropped.
    return { id, kind: "context", label: line };
  });
}

export function VisualDiff({ entries, emptyMessage = "No changes." }: VisualDiffProps) {
  if (entries.length === 0) {
    return (
      <p className="visual-diff__empty" data-testid="visual-diff-empty">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="visual-diff" data-testid="visual-diff">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className={`visual-diff__row visual-diff__row--${entry.kind}`}
          data-testid={`visual-diff-row-${entry.kind}`}
        >
          <span className="visual-diff__glyph" aria-hidden="true">
            {KIND_GLYPH[entry.kind]}
          </span>
          {KIND_LABEL[entry.kind] ? (
            <span className="visual-diff__kind">{KIND_LABEL[entry.kind]}</span>
          ) : null}
          <span className="visual-diff__label">{entry.label}</span>
          {entry.detail ? <span className="visual-diff__detail">{entry.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}
