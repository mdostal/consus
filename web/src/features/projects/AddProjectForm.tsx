import { useEffect, useState } from "react";
import { DirectoryBrowser } from "./DirectoryBrowser";

export interface AddProjectFormProps {
  onSubmit: (name: string, path: string) => void;
  submitting: boolean;
  error?: string | null;
}

/** s3's GET /api/projects/discover candidate shape (server/routes/
 *  projects.ts): a repo-flagged subdirectory of a discovery root that isn't
 *  already registered. */
interface DiscoveredCandidate {
  name: string;
  path: string;
}

const DISCOVER_OPTION_VALUE = "";

/** The missing counterpart to hand-editing `.pHive/consus-projects.json`:
 *  names a project and points it at a repo path on disk. Submitting fires
 *  `POST /api/projects`, which registers it, persists it, and runs an
 *  immediate scan — so the new project's docs show up right away instead
 *  of an empty view.
 *
 * s5 (consus-phase25-project-registration-ux): the path field can be filled
 * three ways — typing it directly (original behavior, unchanged), choosing
 * a zero-configuration candidate from GET /api/projects/discover (matching
 * BranchPicker's label-wraps-select convention exactly), or browsing the
 * filesystem interactively via DirectoryBrowser. All three are additive and
 * converge on the same `path` state; none is a hard requirement (see
 * design-discussion.md §3.3: a repo outside any discoverable root is still
 * registerable by typing it directly). */
export function AddProjectForm({ onSubmit, submitting, error }: AddProjectFormProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [candidates, setCandidates] = useState<DiscoveredCandidate[] | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);

  useEffect(() => {
    fetch("/api/projects/discover")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { candidates: DiscoveredCandidate[] }) => setCandidates(body.candidates ?? []))
      .catch((e) => setDiscoverError((e as Error).message));
  }, []);

  function submit() {
    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    if (!trimmedName || !trimmedPath) return;
    onSubmit(trimmedName, trimmedPath);
  }

  return (
    <form
      className="add-project-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="add-project-form__field">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-repo"
          disabled={submitting}
        />
      </label>
      <label className="add-project-form__field">
        Repo path
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/absolute/path/to/repo"
          disabled={submitting}
        />
      </label>
      <label className="add-project-form__field">
        Discovered repos
        <select
          aria-label="Discovered repos"
          value={DISCOVER_OPTION_VALUE}
          disabled={submitting}
          onChange={(e) => {
            if (e.target.value !== DISCOVER_OPTION_VALUE) setPath(e.target.value);
          }}
        >
          <option value={DISCOVER_OPTION_VALUE}>-- choose a discovered repo --</option>
          {(candidates ?? []).map((c) => (
            <option key={c.path} value={c.path}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={submitting} onClick={() => setBrowserOpen(true)}>
        Browse…
      </button>
      <button type="submit" disabled={submitting || !name.trim() || !path.trim()}>
        {submitting ? "Adding…" : "Add project"}
      </button>
      {discoverError ? (
        <p className="dv__err">Could not load discovered repos: {discoverError}</p>
      ) : null}
      {error ? <p className="dv__err">{error}</p> : null}
      {browserOpen ? (
        <DirectoryBrowser
          onSelect={(selectedPath) => {
            setPath(selectedPath);
            setBrowserOpen(false);
          }}
          onClose={() => setBrowserOpen(false)}
        />
      ) : null}
    </form>
  );
}
