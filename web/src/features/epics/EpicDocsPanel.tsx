import type { EpicDoc, EpicDocKind } from "../../api/epics";
import { tokens } from "../../theme/tokens";
import "../../theme/tokens.css";

export interface EpicDocsPanelProps {
  docs: EpicDoc[];
}

const DOCS: Array<{ kind: EpicDocKind; title: string }> = [
  { kind: "design-discussion", title: "Design Discussion" },
  { kind: "research-brief", title: "Research Brief" },
  { kind: "outline", title: "Outline" },
];

const styles = {
  stack: { display: "grid", gap: 10 },
  detail: {
    border: `1px solid ${tokens.color.line}`,
    borderRadius: 8,
    background: tokens.color.bg,
    overflow: "hidden",
  },
  summary: {
    cursor: "pointer",
    fontWeight: 700,
    padding: "12px 14px",
  },
  body: {
    borderTop: `1px solid ${tokens.color.line}`,
    color: tokens.color.ink,
    margin: 0,
    padding: 14,
    whiteSpace: "pre-wrap",
  },
  muted: { color: tokens.color.inkMuted },
} as const;

export function EpicDocsPanel({ docs }: EpicDocsPanelProps) {
  const docsByKind = new Map<EpicDocKind, EpicDoc>();
  for (const doc of docs) {
    if (!docsByKind.has(doc.kind)) docsByKind.set(doc.kind, doc);
  }

  return (
    <div aria-label="Epic documents" data-testid="epic-docs-panel" style={styles.stack}>
      {DOCS.map((definition) => {
        const doc = docsByKind.get(definition.kind);
        return (
          <details key={definition.kind} data-testid={`epic-doc-${definition.kind}`} open={definition.kind === "design-discussion"} style={styles.detail}>
            <summary style={styles.summary}>{definition.title}</summary>
            <p style={{ ...styles.body, ...(doc ? {} : styles.muted) }}>{doc?.content || "No document available."}</p>
          </details>
        );
      })}
    </div>
  );
}
