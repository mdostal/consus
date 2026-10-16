import { useEffect, useState } from "react";

export interface ProjectClientFieldProps {
  project: string;
  client: string | null;
  /** Called after the server accepted the change. */
  onSaved: (client: string | null) => void;
}

/** PANT-960: sets or clears the selected project's client via
 *  PATCH /api/projects/:project. An empty value makes it ungrouped. */
export function ProjectClientField({ project, client, onSaved }: ProjectClientFieldProps) {
  const [value, setValue] = useState(client ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(client ?? "");
    setError(null);
  }, [project, client]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: value.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSaved(body.client ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const unchanged = value.trim() === (client ?? "");

  return (
    <form className="project-client-field" onSubmit={save}>
      <label>
        Client
        <input
          type="text"
          aria-label="Project client"
          placeholder="Ungrouped"
          value={value}
          maxLength={80}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button type="submit" disabled={saving || unchanged}>
        {saving ? "Saving…" : "Save client"}
      </button>
      {error ? <p className="dv__err">{error}</p> : null}
    </form>
  );
}
