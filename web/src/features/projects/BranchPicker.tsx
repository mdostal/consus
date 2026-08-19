import { useEffect, useState } from "react";

export interface BranchPickerProps {
  project: string;
  /** null means "(default)" — no branch filter, today's exact unfiltered
   *  behavior. Not tied to any specific resolved default-branch name. */
  value: string | null;
  onChange: (branch: string | null) => void;
}

const DEFAULT_OPTION_VALUE = "";

/**
 * s4 (consus-phase24-branch-level-surfacing): the branch picker, populated
 * from GET /api/projects/:project/branches (new in this story — lists
 * local + remote-tracking branches via `git for-each-ref`).
 *
 * "(default)" is always the first option, regardless of what the branches
 * list contains, and represents "no branch filter" — selecting it (or
 * never touching this component at all) must leave every existing
 * decisions-list/doc-view behavior exactly as it was before this story
 * shipped (see design-discussion.md's zero-regression invariant). It is
 * deliberately NOT derived from/excluded against the project's actual
 * resolved default branch (server/adapters/doc-scanner/git-ref.ts's
 * resolveDefaultBranch) — that would require this component to also fetch
 * and reconcile that separately, for no real benefit: picking an actual
 * branch by name (even if it happens to be the same one CI treats as
 * default) is a genuinely different, valid selection from "(default)"
 * meaning "unfiltered".
 */
export function BranchPicker({ project, value, onChange }: BranchPickerProps) {
  const [branches, setBranches] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBranches(null);
    setError(null);
    fetch(`/api/projects/${encodeURIComponent(project)}/branches`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { branches: string[] }) => setBranches(body.branches ?? []))
      .catch((e) => setError((e as Error).message));
  }, [project]);

  return (
    <div className="branch-picker">
      <label>
        Branch
        <select
          aria-label="Select branch"
          value={value ?? DEFAULT_OPTION_VALUE}
          onChange={(e) => onChange(e.target.value === DEFAULT_OPTION_VALUE ? null : e.target.value)}
        >
          <option value={DEFAULT_OPTION_VALUE}>(default)</option>
          {(branches ?? []).map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="dv__err">Could not load branches: {error}</p> : null}
    </div>
  );
}
