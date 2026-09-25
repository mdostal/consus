export interface ArtifactLinkProps {
  url: string;
  label?: string;
}

/** REQ-05: link/embed only — no re-rendering of the Artifact's content. */
export function ArtifactLink({ url, label }: ArtifactLinkProps) {
  return (
    <a className="artifact-link" href={url} target="_blank" rel="noreferrer">
      {label ?? url}
    </a>
  );
}
