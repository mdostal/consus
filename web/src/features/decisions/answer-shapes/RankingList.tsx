import { useState } from "react";
import type { RankingPayload, Verdict } from "./types";

export interface RankingListProps {
  payload: RankingPayload;
  onVerdict: (verdict: Verdict) => void;
}

/**
 * dostal:ranking/v1 renderer — a drag-to-reorder list of the payload's
 * items. Native HTML5 drag-and-drop (draggable list items, no external DnD
 * library) drives the primary interaction; "Move up"/"Move down" buttons on
 * every row are kept as an explicit, keyboard/test-friendly fallback (see
 * this story's design_decisions — the up/down-button fallback is
 * acceptable when drag-and-drop proves impractical, and both share the same
 * `reorder` handler so the two interaction paths always produce identical
 * results). Submitting records a `ranked` verdict with the final item-id
 * order, not per-item rank numbers.
 */
export function RankingList({ payload, onVerdict }: RankingListProps) {
  const [order, setOrder] = useState<string[]>(() => payload.items.map((item) => item.id));
  const [dragId, setDragId] = useState<string | null>(null);

  const byId = new Map(payload.items.map((item) => [item.id, item]));

  function reorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  function moveUp(index: number) {
    reorder(index, index - 1);
  }

  function moveDown(index: number) {
    reorder(index, index + 1);
  }

  function handleDrop(index: number) {
    if (dragId === null) return;
    const fromIndex = order.indexOf(dragId);
    reorder(fromIndex, index);
    setDragId(null);
  }

  return (
    <div className="ranking-list">
      <p className="ranking-list__context">{payload.context}</p>
      <p className="ranking-list__prompt">{payload.prompt}</p>

      <ol className="ranking-list__items" aria-label={payload.prompt} data-testid="ranking-list">
        {order.map((id, index) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <li
              key={id}
              className="ranking-list__item"
              draggable
              data-testid={`ranking-item-${id}`}
              onDragStart={() => setDragId(id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(index);
              }}
            >
              <span className="ranking-list__item-rank">{index + 1}</span>
              <span className="ranking-list__item-label">{item.label}</span>
              <button type="button" aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => moveUp(index)}>
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${item.label} down`}
                disabled={index === order.length - 1}
                onClick={() => moveDown(index)}
              >
                ↓
              </button>
            </li>
          );
        })}
      </ol>

      <div className="ranking-list__actions">
        <button type="button" onClick={() => onVerdict({ kind: "ranked", order })}>
          Submit ranking
        </button>
      </div>
    </div>
  );
}
