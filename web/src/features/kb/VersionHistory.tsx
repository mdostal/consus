export interface KbVersion {
  id: number;
  content: string;
  author: string;
  created_at: string;
}

export interface VersionHistoryProps {
  versions: KbVersion[];
}

/** REQ-08: every prior version is browsable, not just the current state. */
export function VersionHistory({ versions }: VersionHistoryProps) {
  if (versions.length === 0) return null;

  return (
    <ol className="version-history">
      {versions.map((v) => (
        <li key={v.id} className="version-history__item">
          <span className="version-history__author">{v.author}</span>
          <time dateTime={v.created_at}>{v.created_at}</time>
          <p>{v.content}</p>
        </li>
      ))}
    </ol>
  );
}
