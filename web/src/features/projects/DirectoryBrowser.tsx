import { useEffect, useState } from "react";

/** Mirrors server/routes/fs.ts's FsListEntry — the shape GET /api/fs/list
 *  actually returns for each immediate subdirectory of the listed path. */
export interface DirectoryBrowserEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

export interface DirectoryBrowserProps {
  /** Fires with the current directory's absolute path when the operator
   *  clicks "Select this directory" — available regardless of isRepo (see
   *  design-discussion.md §3.3(c): the heuristic is a visual hint, not a
   *  hard gate). The parent (AddProjectForm) uses this to populate its path
   *  field and close the browser. */
  onSelect: (path: string) => void;
  /** Fires when the operator dismisses the browser without selecting
   *  anything (e.g. a "Cancel" action). */
  onClose: () => void;
}

/** Last non-empty path segment of an absolute path — used as a breadcrumb's
 *  label. Falls back to the full path for the rare case of a root-only
 *  path ("/") with no segments. */
function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/**
 * s5 (consus-phase25-project-registration-ux): the operator's explicit ask —
 * "how the ... am i to memorize all of the paths on the computer" — answered
 * as a real interactive filesystem browser, not just auto-suggested
 * siblings (that's s3's GET /api/projects/discover, wired in separately by
 * AddProjectForm). Reuses this app's established fetch/loading/error shape
 * (see BranchPicker.tsx: `data | null`, `error | null`, useEffect-driven
 * fetch) and the dv__err error-display convention.
 *
 * On mount, lists the OS home directory (GET /api/fs/list with no `path` —
 * s2's route defaults to homedir()). Clicking a subdirectory re-fetches with
 * that subdirectory as the new path and pushes it onto a breadcrumb trail;
 * clicking an earlier breadcrumb segment re-fetches that level and truncates
 * the trail back to it, rather than growing it further.
 */
export function DirectoryBrowser({ onSelect, onClose }: DirectoryBrowserProps) {
  // The current directory's resolved absolute path, once known — null only
  // before the very first fetch has resolved (or if it failed outright).
  const [path, setPath] = useState<string | null>(null);
  // Every resolved absolute path visited so far, in breadcrumb order.
  const [trail, setTrail] = useState<string[]>([]);
  const [entries, setEntries] = useState<DirectoryBrowserEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(targetPath: string | null) {
    setEntries(null);
    setError(null);
    const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
    fetch(`/api/fs/list${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { path: string; entries: DirectoryBrowserEntry[] }) => {
        setPath(body.path);
        setEntries(body.entries ?? []);
        setTrail((prev) => {
          const existingIndex = prev.indexOf(body.path);
          // Navigating back to a path already in the trail (via a
          // breadcrumb) truncates rather than appends, so repeated
          // back-and-forth navigation never grows the trail unboundedly.
          return existingIndex !== -1 ? prev.slice(0, existingIndex + 1) : [...prev, body.path];
        });
      })
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="directory-browser" role="region" aria-label="Directory browser">
      <div className="directory-browser__breadcrumbs">
        {trail.map((p, i) => (
          <span key={p} className="directory-browser__crumb">
            <button type="button" onClick={() => load(p)} disabled={i === trail.length - 1}>
              {basename(p)}
            </button>
            {i < trail.length - 1 ? (
              <span className="directory-browser__crumb-sep" aria-hidden="true">
                /
              </span>
            ) : null}
          </span>
        ))}
      </div>

      {error ? <p className="dv__err">Could not list directory: {error}</p> : null}

      {entries === null && !error ? <p className="directory-browser__loading">Loading…</p> : null}

      {entries ? (
        entries.length === 0 ? (
          <p className="directory-browser__empty">No subdirectories.</p>
        ) : (
          <ul className="directory-browser__entries">
            {entries.map((entry) => (
              <li key={entry.path}>
                <button type="button" onClick={() => load(entry.path)}>
                  <span className="directory-browser__entry-name">{entry.name}</span>
                  {entry.isRepo ? <span className="directory-browser__badge">repo</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <div className="directory-browser__actions">
        <button type="button" disabled={!path} onClick={() => path && onSelect(path)}>
          Select this directory
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
