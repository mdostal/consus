export interface KbEntrySummary {
  id: string;
  title: string;
  source_repo: string | null;
  created_at: string;
}

export interface GlobalViewProps {
  entries: KbEntrySummary[];
  onSelect: (id: string) => void;
}

/**
 * REQ-27: the cross-project view — items grouped with a project-name
 * heading per group, not a flat undifferentiated list.
 */
export function GlobalView({ entries, onSelect }: GlobalViewProps) {
  const grouped = new Map<string, KbEntrySummary[]>();
  for (const entry of entries) {
    const project = entry.source_repo ?? "unassigned";
    if (!grouped.has(project)) grouped.set(project, []);
    grouped.get(project)!.push(entry);
  }

  return (
    <div className="global-view">
      {[...grouped.entries()].map(([project, projectEntries]) => (
        <section key={project}>
          <h2>{project}</h2>
          <ul>
            {projectEntries.map((entry) => (
              <li key={entry.id}>
                <button type="button" onClick={() => onSelect(entry.id)}>
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
