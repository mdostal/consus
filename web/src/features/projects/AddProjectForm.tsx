import { useState } from "react";

export interface AddProjectFormProps {
  onSubmit: (name: string, path: string) => void;
  submitting: boolean;
  error?: string | null;
}

/** The missing counterpart to hand-editing `.pHive/consus-projects.json`:
 *  names a project and points it at a repo path on disk. Submitting fires
 *  `POST /api/projects`, which registers it, persists it, and runs an
 *  immediate scan — so the new project's docs show up right away instead
 *  of an empty view. */
export function AddProjectForm({ onSubmit, submitting, error }: AddProjectFormProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

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
      <button type="submit" disabled={submitting || !name.trim() || !path.trim()}>
        {submitting ? "Adding…" : "Add project"}
      </button>
      {error ? <p className="dv__err">{error}</p> : null}
    </form>
  );
}
