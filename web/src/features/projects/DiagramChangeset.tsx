import { VisualDiff, type VisualDiffEntry, type VisualDiffKind } from "../diff/VisualDiff";
import type { DiagramChange, DiagramChangeKind } from "./diagramDiff";

/**
 * The persistent right-rail changeset panel (s2, consus-phase18,
 * design-discussion.md resolved decision #3) — structured, typed rows, not
 * a flat freeform log. "moved" gets its own visually distinct treatment
 * (a different row modifier class + label) since a text-based diagram
 * format has no notion of node position, so a pure move is a materially
 * different kind of change from a structural add/remove/relabel edit.
 *
 * consus-phase28/s2: row rendering (colors, glyphs, kind labels) now comes
 * from the shared VisualDiff component — the same one DocRenderer.tsx uses
 * for its line-diff preview — so a diagram's "added" row and a doc's added
 * line share one visual language instead of two independently maintained
 * ones. This component still owns its own diagram-specific chrome (the
 * "Changeset" title, the running count, the "no pending changes yet" empty
 * copy) — only the per-row rendering is delegated.
 */

const CHANGE_KIND_TO_VISUAL_DIFF: Record<DiagramChangeKind, VisualDiffKind> = {
  added: "add",
  removed: "remove",
  changed: "change",
  moved: "move",
};

function toVisualDiffEntries(changes: DiagramChange[]): VisualDiffEntry[] {
  return changes.map((change) => ({
    id: change.id,
    kind: CHANGE_KIND_TO_VISUAL_DIFF[change.kind],
    label: `${change.entity} ${change.label}`,
    detail: change.detail,
  }));
}

export interface DiagramChangesetProps {
  changes: DiagramChange[];
  /** Optional heading override — skins may reflavor the verb vocabulary
   *  elsewhere, but this panel's own title stays plain per decision #3. */
  title?: string;
}

export function DiagramChangeset({ changes, title = "Changeset" }: DiagramChangesetProps) {
  return (
    <div className="diagram-changeset" data-testid="diagram-changeset">
      <h4 className="diagram-changeset__title">
        {title}
        {changes.length > 0 ? <span className="diagram-changeset__count">({changes.length})</span> : null}
      </h4>
      {changes.length === 0 ? (
        <p className="diagram-changeset__empty">No pending changes yet.</p>
      ) : (
        <VisualDiff entries={toVisualDiffEntries(changes)} />
      )}
    </div>
  );
}

/** A small per-tab dirty-state indicator (design-discussion.md decision #3)
 *  — renders nothing at all when clean, so "only the dirty tab shows its
 *  indicator" is true by construction rather than by a hidden/visible CSS
 *  toggle that a snapshot could miss. */
export function DiagramDirtyDot({ dirty, label }: { dirty: boolean; label: string }) {
  if (!dirty) return null;
  return <span className="diagram-dirty-dot" data-testid="diagram-dirty-dot" aria-label={`${label} has pending changes`} />;
}

/** The global "N pending changes" count (design-discussion.md decision #3),
 *  summed across every diagram tab by the caller — this component just
 *  renders the total, it never computes it, so it stays trivially testable
 *  and correct regardless of how many tabs exist. */
export function DiagramPendingCount({ count }: { count: number }) {
  return (
    <span className="diagram-pending-count" data-testid="diagram-pending-count">
      {count} pending {count === 1 ? "change" : "changes"}
    </span>
  );
}
