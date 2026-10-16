import { useEffect, useRef, useState } from "react";
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
  const [announcement, setAnnouncement] = useState("");
  // Keyboard reordering (PANT-812): the moved row keeps its DOM node (rows
  // are keyed by item id), so focus normally rides along on the pressed
  // button. When that button becomes disabled (the row reached the top or
  // bottom) focus would drop to <body>, so it is handed to the row's other
  // move button instead.
  const moveButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const pendingFocus = useRef<{ id: string; direction: "up" | "down" } | null>(null);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const pressed = moveButtons.current.get(`${pending.id}:${pending.direction}`);
    if (pressed && pressed.disabled) {
      moveButtons.current.get(`${pending.id}:${pending.direction === "up" ? "down" : "up"}`)?.focus();
    }
  }, [order]);

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

  function move(index: number, direction: "up" | "down") {
    const toIndex = direction === "up" ? index - 1 : index + 1;
    if (toIndex < 0 || toIndex >= order.length) return;
    const id = order[index];
    pendingFocus.current = { id, direction };
    reorder(index, toIndex);
    setAnnouncement(`${byId.get(id)?.label ?? id} moved to position ${toIndex + 1} of ${order.length}.`);
  }

  function moveUp(index: number) {
    move(index, "up");
  }

  function moveDown(index: number) {
    move(index, "down");
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
              <button
                type="button"
                ref={(el) => {
                  moveButtons.current.set(`${id}:up`, el);
                }}
                aria-label={`Move ${item.label} up`}
                disabled={index === 0}
                onClick={() => moveUp(index)}
              >
                ↑
              </button>
              <button
                type="button"
                ref={(el) => {
                  moveButtons.current.set(`${id}:down`, el);
                }}
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
      <p role="status" aria-live="polite" className="visually-hidden">
        {announcement}
      </p>

      <div className="ranking-list__actions">
        <button type="button" onClick={() => onVerdict({ kind: "ranked", order })}>
          Submit ranking
        </button>
      </div>
    </div>
  );
}
