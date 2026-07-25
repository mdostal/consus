export interface BacklogEntry {
  id: string;
  title: string;
  created_at: string;
}

export interface BacklogBrowserProps {
  entries: BacklogEntry[];
  onSearch: (query: string) => void;
  onSelect: (id: string) => void;
}

/**
 * REQ-09 (P1 stretch): filter/search across the full KB backlog, not just
 * recently-decided entries.
 */
export function BacklogBrowser({ entries, onSearch, onSelect }: BacklogBrowserProps) {
  return (
    <div className="backlog-browser">
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
