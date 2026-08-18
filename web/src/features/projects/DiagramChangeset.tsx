import type { DiagramChange, DiagramChangeKind } from "./diagramDiff";

/**
 * The persistent right-rail changeset panel (s2, consus-phase18,
 * design-discussion.md resolved decision #3) — structured, typed rows, not
 * a flat freeform log. "moved" gets its own visually distinct treatment
 * (a different row modifier class + label) since a text-based diagram
 * format has no notion of node position, so a pure move is a materially
 * different kind of change from a structural add/remove/relabel edit.
 */

const KIND_LABEL: Record<DiagramChangeKind, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  moved: "Moved",
};

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
        <ul className="diagram-changeset__list">
          {changes.map((change) => (
            <li
              key={change.id}
              className={`diagram-changeset__row diagram-changeset__row--${change.kind}`}
              data-testid={`changeset-row-${change.kind}`}
            >
              <span className="diagram-changeset__kind">{KIND_LABEL[change.kind]}</span>
              <span className="diagram-changeset__subject">
                {change.entity} {change.label}
              </span>
              {change.detail ? <span className="diagram-changeset__detail">{change.detail}</span> : null}
            </li>
          ))}
        </ul>
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
