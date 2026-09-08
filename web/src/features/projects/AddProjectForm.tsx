import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open as openNativeDialog } from "@tauri-apps/plugin-dialog";
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

/** Mirrors the server's own VALID_PROJECT_NAME (server/routes/projects.ts:
 *  /^[a-zA-Z0-9_-]+$/) so an auto-derived name is guaranteed to pass
 *  validation without the operator ever having to think about it. Any
 *  character outside that set becomes a dash; leading/trailing dashes are
 *  trimmed so "My Repo!!" -> "My-Repo", not "-My-Repo-" or "" (which would
 *  leave the submit button disabled with no visible cause — the exact
 *  consus-phase28-follow-up dead-end this replaces). */
function deriveNameFromPath(path: string): string {
  const base = path.replace(/\/+$/, "").split("/").pop() ?? "";
  return base.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

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
 * registerable by typing it directly).
 *
 * consus-phase28 follow-up (found live, on the desktop app): all three of
 * the above wired `path` but never `name` — an operator who picked a
 * candidate or browsed to a folder still had to separately type a Name
 * before the (disabled-until-both-fields-filled) submit button did
 * anything, with nothing on screen explaining why. Every path-setting
 * action now also fills `name` (when it's still empty — never overwriting
 * something the operator already typed) via deriveNameFromPath, editable
 * afterward like any other field.
 *
 * Also adds a native folder picker (Tauri's own dialog, feature-detected
 * via isTauri()) alongside the existing in-app DirectoryBrowser — the
 * desktop app's own filesystem picker, matching Finder's actual
 * open-panel UX (favorites sidebar, search, recents) rather than only the
 * bespoke tree view, which remains the fallback in plain-browser dev mode
 * (`npm run dev`) where no native dialog is available. */
export function AddProjectForm({ onSubmit, submitting, error }: AddProjectFormProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [candidates, setCandidates] = useState<DiscoveredCandidate[] | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [nativeDialogError, setNativeDialogError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects/discover")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { candidates: DiscoveredCandidate[] }) => setCandidates(body.candidates ?? []))
      .catch((e) => setDiscoverError((e as Error).message));
  }, []);

  /** The single place `path` gets set from any of the three non-typed
   *  sources (discovered candidate, in-app browser, native dialog) — always
   *  routes through here so the name-autofill fix applies uniformly and
   *  can't regress by being added to only one of the three call sites. */
  function choosePath(selectedPath: string, suggestedName?: string) {
    setPath(selectedPath);
    setName((current) => (current.trim() ? current : (suggestedName ?? deriveNameFromPath(selectedPath))));
  }

  async function browseNative() {
    setNativeDialogError(null);
    try {
      const selected = await openNativeDialog({ directory: true, multiple: false, title: "Choose a repo to add to Consus" });
      if (typeof selected === "string") choosePath(selected);
    } catch (e) {
      setNativeDialogError((e as Error).message);
    }
  }

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
          onChange={(e) => choosePath(e.target.value)}
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
            if (e.target.value === DISCOVER_OPTION_VALUE) return;
            const picked = (candidates ?? []).find((c) => c.path === e.target.value);
            choosePath(e.target.value, picked?.name);
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
      {isTauri() ? (
        <button type="button" disabled={submitting} onClick={browseNative}>
          Open in Finder…
        </button>
      ) : null}
      <button type="button" disabled={submitting} onClick={() => setBrowserOpen(true)}>
        Browse…
      </button>
      <button type="submit" disabled={submitting || !name.trim() || !path.trim()}>
        {submitting ? "Adding…" : "Add project"}
      </button>
      {discoverError ? (
        <p className="dv__err">Could not load discovered repos: {discoverError}</p>
      ) : null}
      {nativeDialogError ? <p className="dv__err">{nativeDialogError}</p> : null}
      {error ? <p className="dv__err">{error}</p> : null}
      {browserOpen ? (
        <DirectoryBrowser
          onSelect={(selectedPath) => {
            choosePath(selectedPath);
            setBrowserOpen(false);
          }}
          onClose={() => setBrowserOpen(false)}
        />
      ) : null}
    </form>
  );
}
