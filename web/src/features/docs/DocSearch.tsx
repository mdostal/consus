import { useEffect, useState } from "react";

/** p14-4's GET /api/docs/search result shape (one entry per repo, file_path
 *  pair) — matched is ["path"] / ["content"] / ["path","content"]. */
export interface DocSearchResult {
  repo: string;
  file_path: string;
  epic: string | null;
  phase: string | null;
  matched: Array<"path" | "content">;
  content_hash: string;
  last_scanned_at: string;
}

export interface DocSearchProps {
  /** Fires (debounced) with the current query — "" once the box is cleared,
   *  so the parent knows to drop back to the tree view. DocSearch never
   *  owns the fetch itself, matching DocBrowser's fetch-stays-in-the-parent
   *  convention. */
  onSearch: (query: string) => void;
  /** null = no search performed yet (or query cleared); [] = searched, no
   *  matches. */
  results: DocSearchResult[] | null;
  /** Wired directly to DocsSection's existing `open` function — the same
   *  callback shape DocBrowser's onOpen prop already uses. */
  onOpen: (repo: string, filePath: string) => void;
  error?: string | null;
}

const DEBOUNCE_MS = 300;

/**
 * p14-6: a search box over p14-4's GET /api/docs/search. Debounces
 * internally (a small local setTimeout effect — this codebase has no
 * shared debounce utility, and one call site doesn't justify adding one)
 * so the endpoint isn't hit on every keystroke.
 */
export function DocSearch({ onSearch, results, onOpen, error }: DocSearchProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(value);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="doc-search">
      <input
        type="search"
        aria-label="Search docs"
        placeholder="Search docs by path or content…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {error ? <p className="dv__err">Search failed: {error}</p> : null}
      {results !== null ? (
        results.length === 0 ? (
          <p className="doc-search__empty">No docs match "{value}".</p>
        ) : (
          <ul className="doc-search__results">
            {results.map((r) => (
              <li key={`${r.repo} ${r.file_path}`}>
                <button type="button" onClick={() => onOpen(r.repo, r.file_path)}>
                  <span className="doc-search__repo">{r.repo}</span>
                  <span className="doc-search__path">{r.file_path}</span>
                  {r.matched.includes("path") ? (
                    <span className="doc-search__badge doc-search__badge--path">path match</span>
                  ) : null}
                  {r.matched.includes("content") ? (
                    <span className="doc-search__badge doc-search__badge--content">content match</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
