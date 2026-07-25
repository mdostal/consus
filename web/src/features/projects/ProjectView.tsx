import type { KbEntrySummary } from "./GlobalView";

export interface ProjectViewProps {
  project: string;
  /** Already scoped to this project by the caller (via GET /api/kb-entries?project=). */
  entries: KbEntrySummary[];
  onSelect: (id: string) => void;
}

/** REQ-27: a single-project scoped view — only that project's items appear. */
export function ProjectView({ project, entries, onSelect }: ProjectViewProps) {
  return (
    <div className="project-view">
      <h2>{project}</h2>
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
