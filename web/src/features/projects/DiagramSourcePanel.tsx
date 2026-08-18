import type { DiagramCanvasEdgeInput, DiagramCanvasNodeInput } from "./DiagramCanvas";

/**
 * A collapsible, read-only Mermaid `graph TD` source preview (s3,
 * consus-phase18, design-discussion.md resolved decision #4). This is a
 * DERIVED projection of DiagramCanvas's own live node/edge state, not a
 * second independently-editable text surface — a hand-editable source box
 * that could diverge from the visual graph would reintroduce exactly the
 * "two diagram engines to keep in sync" risk the epic's library CBA
 * flagged. Present, identically in structure, in every skin (styling only
 * differs via the shared --consus-* tokens, same as every other diagram
 * surface — see app.css).
 *
 * Deliberate, load-bearing shape choices that keep this genuinely
 * mutation-free (not just "no visible input in the current render"):
 *  - DiagramSourcePanelProps has exactly one callback, onToggle, and it
 *    takes no arguments — it can only ever mean "flip my own open/closed
 *    visibility," never "here is new diagram content." There is no
 *    onChange/onEdit/onSourceChange prop of any kind.
 *  - The source text itself is rendered as a plain pre/code pair — not an
 *    INPUT, TEXTAREA, or an editable-content element — so there is no DOM
 *    node in this component's own output capable of accepting keystrokes
 *    in the first place. "Read-only" isn't a `readOnly` attribute someone
 *    could later delete off a form control; there simply is no form
 *    control here.
 *  - buildDiagramSource below is a pure function: (nodes, edges) -> string,
 *    with no side channel back into the nodes/edges it was given.
 */

export interface DiagramSourcePanelProps {
  nodes: DiagramCanvasNodeInput[];
  edges: DiagramCanvasEdgeInput[];
  open: boolean;
  /** Toggles this panel's own visibility only — takes no arguments, so
   *  there is no code path by which calling it could hand diagram content
   *  back upward. The diagram itself is only ever mutated via
   *  DiagramCanvas's own drag/click/connect/delete interactions (s2). */
  onToggle: () => void;
  /** Optional heading override — skins may reflavor surrounding copy
   *  elsewhere, but this panel's own title stays plain, matching
   *  DiagramChangeset's precedent. */
  title?: string;
}

function sanitizeSourceId(id: string): string {
  return `n_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function escapeSourceLabel(label: string): string {
  return label.replace(/"/g, "&quot;");
}

/**
 * Pure: turns the current React Flow node/edge state into Mermaid `graph
 * TD` source text — one line per node, one `-->` line per edge. Adapts the
 * same id-sanitizing/label-escaping approach DiagramView.tsx's
 * buildMermaidSource established (Mermaid-safe ids, `"` escaped out of
 * labels) rather than inventing a different serialization scheme, but is
 * defined standalone here rather than imported from DiagramView.tsx:
 * ArchitectureDiagramView.tsx (which also hosts this panel) is deliberately
 * standalone from DiagramView.tsx (see its own test asserting it doesn't
 * import from there), and this panel is shared by both.
 */
export function buildDiagramSource(nodes: DiagramCanvasNodeInput[], edges: DiagramCanvasEdgeInput[]): string {
  const lines = ["graph TD"];

  for (const node of nodes) {
    lines.push(`  ${sanitizeSourceId(node.id)}["${escapeSourceLabel(node.label)}"]`);
  }
  for (const edge of edges) {
    lines.push(`  ${sanitizeSourceId(edge.source)} --> ${sanitizeSourceId(edge.target)}`);
  }

  return lines.join("\n");
}

export function DiagramSourcePanel({ nodes, edges, open, onToggle, title = "Source" }: DiagramSourcePanelProps) {
  return (
    <div className="diagram-source-panel" data-testid="diagram-source-panel" data-open={open}>
      <button
        type="button"
        className="diagram-source-panel__toggle"
        // Deliberately a wrapping arrow, not `onClick={onToggle}` directly:
        // React would otherwise pass the click SyntheticEvent through as
        // onToggle's argument, which onToggle's own `() => void` contract
        // says it never takes — this keeps that contract true in practice,
        // not just in the type.
        onClick={() => onToggle()}
        aria-pressed={open}
        aria-expanded={open}
        data-testid="diagram-source-panel-toggle"
      >
        {open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}
      </button>
      {open ? (
        <pre className="diagram-source-panel__source" data-testid="diagram-source-panel-text">
          <code>{buildDiagramSource(nodes, edges)}</code>
        </pre>
      ) : null}
    </div>
  );
}
