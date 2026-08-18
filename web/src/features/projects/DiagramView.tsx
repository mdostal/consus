import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuditPanel, type AuditTrailEntry } from "../audit/AuditPanel";
import { DiagramCanvas, type DiagramCanvasEdgeInput, type DiagramCanvasNodeInput } from "./DiagramCanvas";
import { DiagramChangeset, DiagramDirtyDot } from "./DiagramChangeset";
import { DiagramSourcePanel } from "./DiagramSourcePanel";
import { formatDiagramDiff, type DiagramChange } from "./diagramDiff";
import { useRegisterDiagramActions } from "../command-palette/diagramActionRegistry";

export interface DiagramStory {
  id: string;
  title: string;
  complexity: string | null;
  dependsOn: string[];
}

export interface DiagramEpic {
  id: string;
  title: string;
  stories: DiagramStory[];
}

export interface ProposeChangeInput {
  diff: string;
  description: string;
}

export interface DiagramViewProps {
  repo: string;
  epics: DiagramEpic[];
  /** Present when a proposal was fired and hasn't resolved yet. */
  pendingProposal?: boolean;
  onProposeChange: (input: ProposeChangeInput) => void;
  /** s5: history for this diagram's item (audit_log + proposals), via the
   *  shared AuditPanel. Omit to keep the panel hidden. */
  auditEntries?: AuditTrailEntry[];
  /** s2 (consus-phase18): notified with this diagram's own pending-change
   *  count whenever it changes, so a parent hosting more than one diagram
   *  (this cascade + ArchitectureDiagramView) can show a per-tab dirty dot
   *  and an accurate global "N pending changes" total. */
  onPendingChangesChange?: (count: number) => void;
}

function sanitizeMermaidId(id: string): string {
  return `n_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "&quot;");
}

/**
 * Pure: turns the epics/stories/dependsOn tree into Mermaid `graph LR`
 * source text — one subgraph per epic, one node per story, one edge per
 * dependsOn relationship (dependency -> dependent, matching the direction
 * the old "depends on" list text read in). Kept as-is from before s2 (not
 * wired into this component's own render path any more — see
 * buildCascadeGraph below for the live React Flow graph this component
 * actually edits — but preserved for s3's collapsible Mermaid source
 * panel, which regenerates this same shape live from the graph's current
 * state rather than from the original epics prop).
 */
export function buildMermaidSource(epics: DiagramEpic[]): string {
  const lines = ["graph LR"];

  for (const epic of epics) {
    lines.push(`  subgraph ${sanitizeMermaidId(`epic_${epic.id}`)}["${escapeMermaidLabel(epic.title)}"]`);
    for (const story of epic.stories) {
      const label = story.complexity ? `${story.title} (${story.complexity})` : story.title;
      lines.push(`    ${sanitizeMermaidId(`story_${story.id}`)}["${escapeMermaidLabel(label)}"]`);
    }
    lines.push("  end");
  }

  for (const epic of epics) {
    for (const story of epic.stories) {
      for (const dependsOnId of story.dependsOn) {
        lines.push(`  ${sanitizeMermaidId(`story_${dependsOnId}`)} --> ${sanitizeMermaidId(`story_${story.id}`)}`);
      }
    }
  }

  return lines.join("\n");
}

/** What a rendered node's sanitized id resolves back to. Still used to
 *  round-trip DiagramCanvas's own node ids (see buildCascadeGraph) back to
 *  a story/epic when needed. */
export type DiagramNodeEntry = { kind: "story"; story: DiagramStory } | { kind: "epic"; epic: DiagramEpic };

/**
 * Pure: reverse-lookup from a sanitized node id (as produced by
 * sanitizeMermaidId, same ids buildMermaidSource embeds in the graph source)
 * back to the originating story or epic.
 */
export function buildNodeLookup(epics: DiagramEpic[]): Map<string, DiagramNodeEntry> {
  const lookup = new Map<string, DiagramNodeEntry>();

  for (const epic of epics) {
    lookup.set(sanitizeMermaidId(`epic_${epic.id}`), { kind: "epic", epic });
    for (const story of epic.stories) {
      lookup.set(sanitizeMermaidId(`story_${story.id}`), { kind: "story", story });
    }
  }

  return lookup;
}

/** DiagramCanvas node ids for this diagram — namespaced separately from
 *  sanitizeMermaidId's ids above (kept independent on purpose: this id
 *  scheme only ever has to satisfy DiagramCanvas/React Flow, which has no
 *  restrictions the Mermaid-safe ids above exist to satisfy). */
function epicNodeId(epicId: string): string {
  return `epic:${epicId}`;
}
function storyNodeId(storyId: string): string {
  return `story:${storyId}`;
}

/**
 * Pure: builds the editable React Flow graph (s2, consus-phase18) from the
 * epics/stories/dependsOn tree — one node per epic (level 0), one node per
 * story (level 1, grouped under its epic via groupOrder), one containment
 * edge per epic->story pair, and one dependency edge per dependsOn
 * relationship (dependency -> dependent, same direction buildMermaidSource
 * always used). A tree is a graph, per the epic's own library CBA — no
 * contortion needed to fit DiagramCanvas's {nodes, edges} shape.
 */
export function buildCascadeGraph(epics: DiagramEpic[]): {
  nodes: DiagramCanvasNodeInput[];
  edges: DiagramCanvasEdgeInput[];
} {
  const nodes: DiagramCanvasNodeInput[] = [];
  const edges: DiagramCanvasEdgeInput[] = [];

  epics.forEach((epic, epicIndex) => {
    nodes.push({ id: epicNodeId(epic.id), label: epic.title, level: 0, groupOrder: epicIndex });
    for (const story of epic.stories) {
      const label = story.complexity ? `${story.title} (${story.complexity})` : story.title;
      nodes.push({ id: storyNodeId(story.id), label, level: 1, groupOrder: epicIndex });
      edges.push({ id: `contains:${epic.id}:${story.id}`, source: epicNodeId(epic.id), target: storyNodeId(story.id) });
    }
  });

  for (const epic of epics) {
    for (const story of epic.stories) {
      for (const dependsOnId of story.dependsOn) {
        edges.push({
          id: `depends:${dependsOnId}:${story.id}`,
          source: storyNodeId(dependsOnId),
          target: storyNodeId(story.id),
        });
      }
    }
  }

  return { nodes, edges };
}

/** Builds a legible, always-non-empty description for the auto-fired
 *  proposal from the accumulated change kinds — server/routes/proposals.ts
 *  requires a real description string, and there's no free-text input for
 *  the operator to type one any more now that Fire to harness fires
 *  directly from the structured changeset (s2) rather than a manual
 *  diff/description compose form. */
function summarizeChanges(changes: DiagramChange[]): string {
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  const parts = Array.from(counts.entries()).map(([kind, n]) => `${n} ${kind}`);
  return `${changes.length} change${changes.length === 1 ? "" : "s"} (${parts.join(", ")})`;
}

/**
 * Editable epic/story cascade (s2, consus-phase18) — an editable React Flow
 * canvas (DiagramCanvas) built from the epics/stories/dependsOn tree, a
 * structured typed changeset panel, and a Fire-to-harness action that
 * serializes the accumulated change state into a diff for the existing
 * generic POST /api/proposals flow. Replaces the previous read-only Mermaid
 * render + manual diff/description compose form.
 */
export function DiagramView({ repo, epics, pendingProposal, onProposeChange, auditEntries, onPendingChangesChange }: DiagramViewProps) {
  const [changes, setChanges] = useState<DiagramChange[]>([]);
  const graph = useMemo(() => buildCascadeGraph(epics), [epics]);

  // s3 (consus-phase18): the canvas's own current node/edge state, read out
  // via DiagramCanvas's onLiveStateChange — used only to regenerate the
  // collapsible Mermaid source panel's preview text. Seeded with `graph` so
  // there's never a flash of an empty preview before DiagramCanvas's first
  // mount effect fires.
  const [liveGraph, setLiveGraph] = useState<{ nodes: DiagramCanvasNodeInput[]; edges: DiagramCanvasEdgeInput[] }>(graph);
  const [sourceOpen, setSourceOpen] = useState(false);

  // A freshly-loaded repo (or a repo switch) starts clean — no carried-over
  // edits from a previous diagram's session.
  useEffect(() => {
    setChanges([]);
  }, [repo]);

  useEffect(() => {
    onPendingChangesChange?.(changes.length);
  }, [changes.length, onPendingChangesChange]);

  const handleCanvasChange = useCallback((change: DiagramChange) => {
    setChanges((prev) => [...prev, change]);
  }, []);

  const handleLiveStateChange = useCallback((nodes: DiagramCanvasNodeInput[], edges: DiagramCanvasEdgeInput[]) => {
    setLiveGraph({ nodes, edges });
  }, []);

  const toggleSourcePanel = useCallback(() => setSourceOpen((v) => !v), []);

  const fire = useCallback(() => {
    if (changes.length === 0) return;
    onProposeChange({ diff: formatDiagramDiff(changes), description: summarizeChanges(changes) });
    setChanges([]);
  }, [changes, onProposeChange]);

  // s4 (consus-phase18): scrolls this diagram's own section into view and
  // moves real DOM focus onto it — the adapted "switch diagram tab" ->
  // "focus diagram section" shortcut for the real stacked (not tabbed)
  // layout (see App.tsx's ProjectsSection).
  const rootRef = useRef<HTMLDivElement>(null);
  const focusDiagram = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    el.scrollIntoView?.({ behavior: "smooth", block: "start" });
    el.focus();
  }, []);

  useRegisterDiagramActions({
    kind: "cascade",
    label: `${repo} epic/story diagram`,
    focus: focusDiagram,
    toggleSourcePanel,
    sourcePanelOpen: sourceOpen,
    fire,
    fireEnabled: changes.length > 0,
  });

  return (
    <div className="diagram-view" ref={rootRef} tabIndex={-1} data-testid="diagram-view-root">
      <div className="diagram-view__header">
        <h3>
          {repo} — epic/story diagram <DiagramDirtyDot dirty={changes.length > 0} label={`${repo} epic/story diagram`} />
        </h3>
        {pendingProposal ? <span className="pill pill--pending">change proposed…</span> : null}
        <button type="button" onClick={fire} disabled={changes.length === 0}>
          Fire to harness
        </button>
      </div>

      {epics.length === 0 ? (
        <p className="state">No epics yet for {repo}.</p>
      ) : (
        <div className="diagram-view__body">
          <div className="diagram-view__graph-area" data-testid="diagram-view-graph-area">
            <div className="diagram-view__graph" data-testid="diagram-view-graph">
              <DiagramCanvas
                key={repo}
                nodes={graph.nodes}
                edges={graph.edges}
                onChange={handleCanvasChange}
                onLiveStateChange={handleLiveStateChange}
              />
            </div>
            <DiagramSourcePanel nodes={liveGraph.nodes} edges={liveGraph.edges} open={sourceOpen} onToggle={toggleSourcePanel} />
          </div>
          <DiagramChangeset changes={changes} />
        </div>
      )}

      {auditEntries ? (
        <div className="diagram-view__history">
          <h4>History</h4>
          <AuditPanel entries={auditEntries} />
        </div>
      ) : null}
    </div>
  );
}
