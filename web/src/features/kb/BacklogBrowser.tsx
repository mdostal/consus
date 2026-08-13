export interface BacklogEntry {
  id: string;
  title: string;
  created_at: string;
}

export type KbCollection = "marketing" | "boundary-decisions" | "plans" | "artifacts" | "general";

const COLLECTION_LABELS: Record<KbCollection, string> = {
  general: "General",
  marketing: "Marketing",
  "boundary-decisions": "Boundary Decisions",
  plans: "Plans",
  artifacts: "Artifacts",
};

const COLLECTIONS: KbCollection[] = ["general", "marketing", "boundary-decisions", "plans", "artifacts"];

export interface BacklogBrowserProps {
  entries: BacklogEntry[];
  onSearch: (query: string) => void;
  onSelect: (id: string) => void;
  /** kb-01: collection tabs. Omit both to keep the plain ungrouped view — no
   *  broken empty state when the caller hasn't wired collection filtering. */
  activeCollection?: KbCollection | null;
  onSelectCollection?: (collection: KbCollection | null) => void;
}

/**
 * REQ-09 (P1 stretch): filter/search across the full KB backlog, not just
 * recently-decided entries. kb-01: optional collection tabs on top of that —
 * ported from hive:~/.review-bootstrap/consus-kb01's collection concept.
 */
export function BacklogBrowser({
  entries,
  onSearch,
  onSelect,
  activeCollection = null,
  onSelectCollection,
}: BacklogBrowserProps) {
  return (
    <div className="backlog-browser">
      {onSelectCollection ? (
        <div className="backlog-browser__tabs" role="tablist" aria-label="KB collections">
          <button
            type="button"
            role="tab"
            aria-selected={activeCollection === null}
            onClick={() => onSelectCollection(null)}
          >
            All
          </button>
          {COLLECTIONS.map((collection) => (
            <button
              key={collection}
              type="button"
              role="tab"
              aria-selected={activeCollection === collection}
              onClick={() => onSelectCollection(collection)}
            >
              {COLLECTION_LABELS[collection]}
            </button>
          ))}
        </div>
      ) : null}

      <input
        type="search"
        role="searchbox"
        aria-label="Search the KB backlog"
        onChange={(e) => onSearch(e.target.value)}
      />
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button type="button" onClick={() => onSelect(entry.id)}>
              {entry.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
