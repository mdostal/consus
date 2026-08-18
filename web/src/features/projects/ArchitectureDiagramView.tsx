import { useCallback, useEffect, useState } from "react";
import { DiagramCanvas, type DiagramCanvasEdgeInput, type DiagramCanvasNodeInput } from "./DiagramCanvas";
import { DiagramChangeset, DiagramDirtyDot } from "./DiagramChangeset";
import { computeLevelsFromEdges } from "./diagramLayout";
import { formatDiagramDiff, type DiagramChange } from "./diagramDiff";
import { parseMermaidGraph } from "./mermaidGraphParse";

export interface ProposeChangeInput {
  diff: string;
  description: string;
}

export interface ArchitectureDiagramViewProps {
  repo: string;
  topLevel: string;
  fullComponent: string;
  /** s2 (consus-phase18): this diagram kind previously had no propose-a-
   *  change wiring at all (no item id existed for it). Optional so callers
   *  that genuinely have nothing to fire to (e.g. an older/lighter host)
   *  can still render a read-view without it. */
  onProposeChange?: (input: ProposeChangeInput) => void;
  pendingProposal?: boolean;
  /** Notified with this diagram's own pending-change count (summed across
   *  both the Top level and Full component sub-views) whenever it changes —
   *  same per-tab dirty-dot / global-count contract as DiagramView.tsx. */
  onPendingChangesChange?: (count: number) => void;
}

type Tab = "topLevel" | "fullComponent";

/**
 * Pure: turns one of { topLevel, fullComponent }'s parsed Mermaid graphs
 * into DiagramCanvas's {nodes, edges} shape — levels are derived
 * structurally (computeLevelsFromEdges) since a directory graph has no
 * separate "epic vs story" concept the way the cascade does; it's just a
 * root and however many levels of containment/reference edges
 * diagram-generator.ts produced.
 */
export function buildArchitectureGraph(source: string): { nodes: DiagramCanvasNodeInput[]; edges: DiagramCanvasEdgeInput[] } {
  const parsed = parseMermaidGraph(source);
  const nodeIds = parsed.nodes.map((n) => n.id);
  const levels = computeLevelsFromEdges(nodeIds, parsed.edges);

  const nodes: DiagramCanvasNodeInput[] = parsed.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    level: levels.get(n.id) ?? 0,
  }));
  const edges: DiagramCanvasEdgeInput[] = parsed.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));

  return { nodes, edges };
}

function summarizeChanges(changes: DiagramChange[]): string {
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  const parts = Array.from(counts.entries()).map(([kind, n]) => `${n} ${kind}`);
  return `${changes.length} change${changes.length === 1 ? "" : "s"} (${parts.join(", ")})`;
}

/**
 * A small, standalone editable pane for a single named graph — used twice
 * below, once per tab, so each pane owns its own DiagramCanvas + changeset
 * independently, contributing into the shared change list the parent keeps
 * (both sub-views count toward one "architecture" diagram's dirty state,
 * not two — see design-discussion.md decision #3, which draws the
 * dirty-tab line at cascade-vs-architecture, not at this internal Top
 * level/Full component split).
 */
function ArchitectureGraphPane({
  source,
  label,
  testId,
  onChange,
}: {
  source: string;
  label: string;
  testId: string;
  onChange: (change: DiagramChange) => void;
}) {
  const graph = buildArchitectureGraph(source);
  return (
    <div className="architecture-diagram-view__graph" role="img" aria-label={label} data-testid={testId}>
      <DiagramCanvas nodes={graph.nodes} edges={graph.edges} onChange={onChange} />
    </div>
  );
}

/**
 * Renders a repo's real directory-structure diagram — both the shallow
 * `topLevel` view and the richer `fullComponent` view — as tabbed, editable
 * React Flow canvases (s2, consus-phase18). Replaces the previous read-only
 * Mermaid render; the two tabs share one changeset/dirty-state/Fire-to-
 * harness surface for the diagram as a whole. Standalone from
 * DiagramView.tsx by design (see this file's own test asserting it doesn't
 * import from there): this response has no story/epic identities, and its
 * graph comes from parsing Mermaid text (mermaidGraphParse.ts) rather than
 * building directly from structured API data.
 */
export function ArchitectureDiagramView({
  repo,
  topLevel,
  fullComponent,
  onProposeChange,
  pendingProposal,
  onPendingChangesChange,
}: ArchitectureDiagramViewProps) {
  const [tab, setTab] = useState<Tab>("topLevel");
  const [changes, setChanges] = useState<DiagramChange[]>([]);

  useEffect(() => {
    setChanges([]);
  }, [repo]);

  useEffect(() => {
    onPendingChangesChange?.(changes.length);
  }, [changes.length, onPendingChangesChange]);

  const handleCanvasChange = useCallback((change: DiagramChange) => {
    setChanges((prev) => [...prev, change]);
  }, []);

  const fire = () => {
    if (changes.length === 0 || !onProposeChange) return;
    onProposeChange({ diff: formatDiagramDiff(changes), description: summarizeChanges(changes) });
    setChanges([]);
  };

  return (
    <div className="architecture-diagram-view">
      <div className="architecture-diagram-view__header">
        <h3>
          {repo} — architecture diagram{" "}
          <DiagramDirtyDot dirty={changes.length > 0} label={`${repo} architecture diagram`} />
        </h3>
        {pendingProposal ? <span className="pill pill--pending">change proposed…</span> : null}
        {onProposeChange ? (
          <button type="button" onClick={fire} disabled={changes.length === 0}>
            Fire to harness
          </button>
        ) : null}
      </div>

      <div className="architecture-diagram-view__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "topLevel"}
          className={tab === "topLevel" ? "consus__nav-btn consus__nav-btn--active" : "consus__nav-btn"}
          onClick={() => setTab("topLevel")}
        >
          Top level
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "fullComponent"}
          className={tab === "fullComponent" ? "consus__nav-btn consus__nav-btn--active" : "consus__nav-btn"}
          onClick={() => setTab("fullComponent")}
        >
          Full component
        </button>
      </div>

      <div className="architecture-diagram-view__body">
        {tab === "topLevel" ? (
          <ArchitectureGraphPane
            key="topLevel"
            source={topLevel}
            label={`${repo} top-level architecture diagram`}
            testId="architecture-diagram-view-graph-top-level"
            onChange={handleCanvasChange}
          />
        ) : (
          <ArchitectureGraphPane
            key="fullComponent"
            source={fullComponent}
            label={`${repo} full-component architecture diagram`}
            testId="architecture-diagram-view-graph-full-component"
            onChange={handleCanvasChange}
          />
        )}
        <DiagramChangeset changes={changes} />
      </div>
    </div>
  );
}
