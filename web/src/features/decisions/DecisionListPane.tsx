import type { KeyboardEvent } from "react";

/** Structurally compatible with App.tsx's DecisionItem — duck-typed on
 *  purpose so this file has no import from App.tsx. */
export interface DecisionListItem {
  id: string;
  title: string;
  status: string;
  decided_at: string | null;
  decision_type?: string | null;
}

function Row({
  item,
  selected,
  onSelect,
}: {
  item: DecisionListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  function handleKeyDown(e: KeyboardEvent<HTMLLIElement>) {
    // Space's default behavior (page scroll) is only relevant when the
    // element is focused and interactive — suppress it here so keyboard
    // activation feels like a real control, matching Enter.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(item.id);
    }
  }

  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={`decision-list__row ${selected ? "decision-list__row--selected" : ""}`}
      onClick={() => onSelect(item.id)}
      onKeyDown={handleKeyDown}
    >
      <span className="decision-list__row-title">{item.title}</span>
      <span className="decision-list__row-meta">
        <span className={`dv__pill ${item.decided_at ? "dv__pill--done" : ""}`}>{item.status}</span>
        {item.decision_type ? <span className="decision-list__row-type">{item.decision_type}</span> : null}
      </span>
    </li>
  );
}

/**
 * Presentational left-pane list for the Decisions two-pane layout —
 * compact, clickable/keyboard-activatable rows grouped under the same
 * "Needs you (N)" / "Decided (N)" headings the old flat layout used,
 * rather than a full DecisionView/DecisionCard per row (that's exactly the
 * unscannable-list problem this layout fixes).
 */
export function DecisionListPane({
  items,
  selectedId,
  onSelect,
}: {
  items: DecisionListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const open = items.filter((d) => !d.decided_at);
  const decided = items.filter((d) => d.decided_at);

  return (
    <div className="decision-list">
      <p className="group-heading">Needs you ({open.length})</p>
      {open.length === 0 ? (
        <div className="empty">
          <strong>Nothing waiting on you</strong>
          Every open decision has been answered. New decisions land here as agents surface them.
        </div>
      ) : (
        <ul className="decision-list__group" role="listbox" aria-label="Needs you">
          {open.map((d) => (
            <Row key={d.id} item={d} selected={d.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}

      {decided.length > 0 ? (
        <>
          <p className="group-heading">Decided ({decided.length})</p>
          <ul className="decision-list__group" role="listbox" aria-label="Decided">
            {decided.map((d) => (
              <Row key={d.id} item={d} selected={d.id === selectedId} onSelect={onSelect} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
