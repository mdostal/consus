export interface GroupedDoc {
  epic: string | null;
  file_path: string;
  content_hash: string;
  last_scanned_at: string;
}

export type GroupedDocs = Record<string, Record<string, GroupedDoc[]>>;

export interface DocBrowserProps {
  grouped: GroupedDocs;
  onOpen: (repo: string, filePath: string) => void;
}

/**
 * REQ-03: browse generated docs grouped repo -> epic -> phase. New docs
 * appear here without a manual pull step — this component just renders
 * whatever the /api/docs response currently contains.
 */
export function DocBrowser({ grouped, onOpen }: DocBrowserProps) {
  return (
    <nav className="doc-browser">
      {Object.entries(grouped).map(([repo, phases]) => (
        <section key={repo}>
          <h2>{repo}</h2>
          {Object.entries(phases).map(([phase, docs]) => (
            <div key={phase}>
              <h3>{phase}</h3>
              <ul>
                {docs.map((doc) => (
                  <li key={doc.file_path}>
                    {doc.epic ? <span className="doc-browser__epic">{doc.epic}</span> : null}
                    <button type="button" onClick={() => onOpen(repo, doc.file_path)}>
                      {doc.file_path}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </nav>
  );
}
