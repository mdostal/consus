import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutByLevel, type LayoutNodeInput } from "./diagramLayout";
import { buildEdgePath, useEdgeCurveStyle, type EdgeCurveStyle } from "./diagramEdgeStyle";
import { createDiagramChange, type DiagramChange } from "./diagramDiff";

/**
 * The shared editable React Flow canvas (s2, consus-phase18) both
 * DiagramView.tsx (epic/story cascade) and ArchitectureDiagramView.tsx
 * (directory graph) compose. Owns its own node/edge state internally
 * (uncontrolled from the caller's perspective — the caller re-mounts via a
 * `key` prop when the underlying source data changes, the same pattern
 * ArchitectureDiagramView.tsx already used for its two Mermaid tabs) and
 * reports every real edit as a typed DiagramChange via onChange, which the
 * caller accumulates into its own changeset panel.
 *
 * Real interactions implemented here, one component: drag-by-handle-only
 * node movement (React Flow's own `dragHandle` prop, not custom hit-test
 * logic — decision #6), click-label-to-edit-in-place, an add-node action, a
 * click-driven connect flow (decision: explicit and reliably testable,
 * rather than depending on handle-drag-and-drop hit-testing math), and both
 * edge-deletion paths (decision #5) — direct click to snip, and
 * shift-click to multi-select then "Delete selected".
 */

export interface DiagramCanvasNodeInput {
  id: string;
  label: string;
  level: number;
  groupOrder?: number;
}

export interface DiagramCanvasEdgeInput {
  id: string;
  source: string;
  target: string;
}

export interface DiagramCanvasProps {
  nodes: DiagramCanvasNodeInput[];
  edges: DiagramCanvasEdgeInput[];
  onChange: (change: DiagramChange) => void;
  /** s3 (consus-phase18): a read-only broadcast of this canvas's own
   *  current node/edge state, fired whenever rfNodes/rfEdges change
   *  (including once on mount). Exists purely so a caller — the
   *  collapsible Mermaid source panel — can regenerate a live preview from
   *  the actual current graph rather than replaying the onChange log to
   *  reconstruct it. This is a read-out only: nothing reads a value back
   *  from the caller through it, and DiagramCanvas's own rfNodes/rfEdges
   *  state (via useNodesState/useEdgesState above) remains the single
   *  place that actually gets mutated. */
  onLiveStateChange?: (nodes: DiagramCanvasNodeInput[], edges: DiagramCanvasEdgeInput[]) => void;
}

/**
 * Pure: decides whether a completed node drag was a real move (vs. e.g. a
 * handle click/tap that never actually displaced the node) and, if so,
 * builds the resulting "moved" DiagramChange. Split out from
 * handleNodeDragStop below specifically so the drag-vs-no-op threshold and
 * the shape of a "moved" row are unit-testable directly — real
 * pointer-drag physics (react-flow's underlying d3-drag) isn't something
 * jsdom can simulate, the same real limitation React Flow's own test suite
 * works around with a real-browser tool (this story's report covers a
 * Playwright smoke check against the running app for that reason).
 */
export function buildMovedChange(
  nodeId: string,
  label: string,
  start: { x: number; y: number } | undefined,
  end: { x: number; y: number },
): DiagramChange | null {
  if (!start) return null;
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  if (dx < 1 && dy < 1) return null; // no real movement — not a "moved" edit
  return createDiagramChange({
    kind: "moved",
    entity: "node",
    entityId: nodeId,
    label,
    detail: `moved to (${Math.round(end.x)}, ${Math.round(end.y)})`,
  });
}

type DiagramFlowNodeData = { label: string; width: number };
type DiagramFlowNode = Node<DiagramFlowNodeData, "diagramNode">;
type DiagramFlowEdge = Edge<Record<string, never>, "diagramEdge">;

interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DiagramCanvasContextValue {
  connectMode: boolean;
  connectSourceId: string | null;
  onActivateForConnect: (id: string) => void;
  onCommitLabel: (id: string, label: string) => void;
  onRemoveNode: (id: string) => void;
  edgeStyle: EdgeCurveStyle;
  selectedEdgeIds: Set<string>;
  onSnipEdge: (id: string) => void;
  onToggleEdgeSelection: (id: string) => void;
  /** Keyboard equivalent of a pointer drag (s1, consus-phase20): nudges a
   *  node by a fixed (dx, dy) step and — via the same buildMovedChange this
   *  file's pointer-drag handler already uses below — logs the identical
   *  "moved" DiagramChange shape a pointer drag produces. Kept on context
   *  (not a prop on DiagramNodeComponent) for the same reason every other
   *  edit-producing callback here is: the node component only knows its own
   *  id/data, not the rest of the graph or how to mutate rfNodes/onChange. */
  onNudgeNode: (id: string, dx: number, dy: number) => void;
  /** Every current node's own label, keyed by id — DiagramEdgeComponent uses
   *  this to build a real accessible name ("Connection from X to Y") for its
   *  keyboard-focusable path, the same source/target label pairing
   *  buildEdgeLabel already uses for changeset rows. */
  nodeLabelById: Map<string, string>;
  /** Every current node's own box, keyed by id — DiagramEdgeComponent uses
   *  this (not React Flow's own computed EdgeProps sourceX/Y/targetX/Y) to
   *  place edge endpoints. React Flow only fills in sourceX/Y once a node
   *  has gone through its internal DOM-measurement pass (a real
   *  ResizeObserver notification, asynchronous even in a real browser); this
   *  app already knows every node's exact box up front from
   *  diagramLayout.ts, so reading it straight from here keeps edges correct
   *  immediately on mount and independent of any measurement timing. */
  nodeRectById: Map<string, NodeRect>;
}

const DiagramCanvasContext = createContext<DiagramCanvasContextValue | null>(null);

function useDiagramCanvasContext(): DiagramCanvasContextValue {
  const ctx = useContext(DiagramCanvasContext);
  if (!ctx) throw new Error("Diagram node/edge components must render inside DiagramCanvas");
  return ctx;
}

/** Fixed node box height (px) — every node renders one row of chrome
 *  (handle + label + remove), so unlike width (label-dependent, see
 *  diagramLayout.ts), a constant height is accurate, not just convenient.
 *  Set explicitly as the node's own `height` (not just CSS), which also
 *  lets React Flow consider the node "measured" (nodeHasDimensions) without
 *  depending on a real ResizeObserver pass — needed for edges to compute a
 *  path at all in a non-painting test environment like jsdom. */
const NODE_HEIGHT_PX = 48;

/** Node-level (not a top-level <ReactFlow> prop — that's a common mix-up
 *  since v11 supported it as a global prop) drag-handle selector, matching
 *  the class DiagramNodeComponent's dedicated handle element renders.
 *  Design decision #6: drag is handle-only, never whole-node-body, so a
 *  click-to-edit-label gesture and a drag-to-move gesture are never
 *  ambiguous for the same click target. */
const DRAG_HANDLE_SELECTOR = ".diagram-canvas__drag-handle";

/** Fixed keyboard-nudge step (px) for arrow-key node move (s1,
 *  consus-phase20) — a real, visible design choice with no single right
 *  answer (see design-discussion.md's risk note), tuned to be clearly
 *  perceptible without needing many presses to cross the canvas. */
const NUDGE_STEP_PX = 20;

const ARROW_KEY_DELTAS: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -NUDGE_STEP_PX },
  ArrowDown: { dx: 0, dy: NUDGE_STEP_PX },
  ArrowLeft: { dx: -NUDGE_STEP_PX, dy: 0 },
  ArrowRight: { dx: NUDGE_STEP_PX, dy: 0 },
};

function buildInitialGraph(
  inputNodes: DiagramCanvasNodeInput[],
  inputEdges: DiagramCanvasEdgeInput[],
): { nodes: DiagramFlowNode[]; edges: DiagramFlowEdge[] } {
  const layoutInputs: LayoutNodeInput[] = inputNodes.map((n) => ({
    id: n.id,
    label: n.label,
    level: n.level,
    groupOrder: n.groupOrder,
  }));
  const positions = layoutByLevel(layoutInputs);

  const nodes: DiagramFlowNode[] = inputNodes.map((n) => {
    const pos = positions.get(n.id)!;
    return {
      id: n.id,
      type: "diagramNode",
      position: { x: pos.x, y: pos.y },
      data: { label: n.label, width: pos.width },
      style: { width: pos.width },
      width: pos.width,
      height: NODE_HEIGHT_PX,
      dragHandle: DRAG_HANDLE_SELECTOR,
    };
  });

  const edges: DiagramFlowEdge[] = inputEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "diagramEdge",
    data: {},
  }));

  return { nodes, edges };
}

function DiagramNodeComponent({ id, data }: NodeProps<DiagramFlowNode>) {
  const ctx = useDiagramCanvasContext();
  const { label, width } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  useEffect(() => {
    if (!editing) setDraft(label);
  }, [label, editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    ctx.onCommitLabel(id, trimmed.length > 0 ? trimmed : label);
  }, [ctx, id, draft, label]);

  const cancel = useCallback(() => {
    setDraft(label);
    setEditing(false);
  }, [label]);

  const isConnectSource = ctx.connectSourceId === id;

  /** Keyboard equivalent of the pointer drag (s1, consus-phase20): while the
   *  handle has focus, arrow keys nudge the node by NUDGE_STEP_PX in the
   *  corresponding direction via ctx.onNudgeNode, which reuses buildMovedChange
   *  — the exact same "is this a real move" logic and "moved" row shape
   *  handleNodeDragStop already produces for a pointer drag, not a second,
   *  parallel implementation. Any other key is left alone (e.g. Tab still
   *  moves focus normally). */
  const handleDragHandleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    const delta = ARROW_KEY_DELTAS[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    ctx.onNudgeNode(id, delta.dx, delta.dy);
  };

  return (
    <div
      className={`diagram-canvas__node${isConnectSource ? " diagram-canvas__node--connect-source" : ""}`}
      style={{ width }}
      data-testid={`diagram-node-${id}`}
    >
      <Handle type="target" position={Position.Top} className="diagram-canvas__port" />
      <div className="diagram-canvas__node-row">
        <span
          className="diagram-canvas__drag-handle"
          data-testid={`diagram-node-drag-handle-${id}`}
          aria-label={`Move ${label}`}
          title="Drag to move"
          role="button"
          tabIndex={0}
          onKeyDown={handleDragHandleKeyDown}
        >
          ⠿
        </span>
        {editing ? (
          <input
            className="diagram-canvas__node-input"
            data-testid={`diagram-node-input-${id}`}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="diagram-canvas__node-label"
            data-testid={`diagram-node-label-${id}`}
            onClick={() => (ctx.connectMode ? ctx.onActivateForConnect(id) : setEditing(true))}
          >
            {label}
          </button>
        )}
        <button
          type="button"
          className="diagram-canvas__node-remove"
          data-testid={`diagram-node-remove-${id}`}
          aria-label={`Remove ${label}`}
          onClick={() => ctx.onRemoveNode(id)}
        >
          ×
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} className="diagram-canvas__port" />
    </div>
  );
}

function DiagramEdgeComponent({ id, source, target }: EdgeProps<DiagramFlowEdge>) {
  const ctx = useDiagramCanvasContext();
  const sourceRect = ctx.nodeRectById.get(source);
  const targetRect = ctx.nodeRectById.get(target);
  const selected = ctx.selectedEdgeIds.has(id);

  if (!sourceRect || !targetRect) return null;

  const { path } = buildEdgePath(
    sourceRect.x + sourceRect.width / 2,
    sourceRect.y + sourceRect.height,
    targetRect.x + targetRect.width / 2,
    targetRect.y,
    ctx.edgeStyle,
  );

  const sourceLabel = ctx.nodeLabelById.get(source) ?? source;
  const targetLabel = ctx.nodeLabelById.get(target) ?? target;

  const handleClick = (event: MouseEvent<SVGPathElement>) => {
    event.stopPropagation();
    if (event.shiftKey) {
      ctx.onToggleEdgeSelection(id);
    } else {
      ctx.onSnipEdge(id);
    }
  };

  /** Keyboard equivalent of the direct-click snip path (s1, consus-phase20):
   *  Enter or Space on a focused edge calls the exact same ctx.onSnipEdge
   *  the click handler above already calls — same "removed" changeset row.
   *  Deliberately does not mirror the shift-click toggle-select path; a
   *  keyboard operator has no equivalent of "shift" here to disambiguate,
   *  and the multi-select "Delete selected" flow is already fully
   *  keyboard-operable via its own real <button>. */
  const handleKeyDown = (event: KeyboardEvent<SVGPathElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    ctx.onSnipEdge(id);
  };

  return (
    <path
      d={path}
      fill="none"
      className={`diagram-canvas__edge${selected ? " diagram-canvas__edge--selected" : ""}`}
      data-testid={`diagram-edge-${id}`}
      data-source={source}
      data-target={target}
      tabIndex={0}
      role="button"
      aria-label={`Connection from ${sourceLabel} to ${targetLabel}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    />
  );
}

const NODE_TYPES: NodeTypes = { diagramNode: DiagramNodeComponent };
const EDGE_TYPES: EdgeTypes = { diagramEdge: DiagramEdgeComponent };

export function DiagramCanvas({ nodes, edges, onChange, onLiveStateChange }: DiagramCanvasProps) {
  const initial = useMemo(() => buildInitialGraph(nodes, edges), [nodes, edges]);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<DiagramFlowNode>(initial.nodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<DiagramFlowEdge>(initial.edges);

  // level/groupOrder only ever mattered for the one-time initial layout
  // (buildInitialGraph above) — rfNodes itself doesn't carry them, so this
  // looks the original value back up by id (falling back to level 0 for a
  // node added after mount, e.g. via addNode below, which never had one).
  const originalLevelById = useMemo(() => {
    const map = new Map<string, { level: number; groupOrder?: number }>();
    for (const n of nodes) map.set(n.id, { level: n.level, groupOrder: n.groupOrder });
    return map;
  }, [nodes]);

  useEffect(() => {
    if (!onLiveStateChange) return;
    const liveNodes: DiagramCanvasNodeInput[] = rfNodes.map((n) => {
      const orig = originalLevelById.get(n.id);
      return { id: n.id, label: n.data.label, level: orig?.level ?? 0, groupOrder: orig?.groupOrder };
    });
    const liveEdges: DiagramCanvasEdgeInput[] = rfEdges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
    onLiveStateChange(liveNodes, liveEdges);
  }, [rfNodes, rfEdges, originalLevelById, onLiveStateChange]);

  const [connectMode, setConnectMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());
  const edgeStyle = useEdgeCurveStyle();

  const rfNodesRef = useRef(rfNodes);
  useEffect(() => {
    rfNodesRef.current = rfNodes;
  }, [rfNodes]);
  const rfEdgesRef = useRef(rfEdges);
  useEffect(() => {
    rfEdgesRef.current = rfEdges;
  }, [rfEdges]);
  const connectSourceIdRef = useRef(connectSourceId);
  useEffect(() => {
    connectSourceIdRef.current = connectSourceId;
  }, [connectSourceId]);

  const getNodeLabel = useCallback((id: string) => rfNodesRef.current.find((n) => n.id === id)?.data.label ?? id, []);

  // Reactive (unlike the refs above, deliberately): edges must re-render as
  // nodes move, including live during a drag, so this is derived from state
  // every render rather than read from a ref.
  const nodeRectById = useMemo(() => {
    const map = new Map<string, NodeRect>();
    for (const n of rfNodes) {
      map.set(n.id, { x: n.position.x, y: n.position.y, width: n.data.width, height: NODE_HEIGHT_PX });
    }
    return map;
  }, [rfNodes]);
  // Same reactivity rationale as nodeRectById above — DiagramEdgeComponent's
  // accessible name must reflect the current label, including right after a
  // click-to-edit-label rename, not a stale one from a ref.
  const nodeLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of rfNodes) map.set(n.id, n.data.label);
    return map;
  }, [rfNodes]);
  const buildEdgeLabel = useCallback(
    (source: string, target: string) => `${getNodeLabel(source)} -> ${getNodeLabel(target)}`,
    [getNodeLabel],
  );

  const nodeCounterRef = useRef(0);
  const addNode = useCallback(() => {
    nodeCounterRef.current += 1;
    const newId = `new-node-${nodeCounterRef.current}`;
    const label = `New node ${nodeCounterRef.current}`;
    setRfNodes((nds) => {
      const maxY = nds.length > 0 ? Math.max(...nds.map((n) => n.position.y)) : 0;
      const width = 140;
      return [
        ...nds,
        {
          id: newId,
          type: "diagramNode",
          position: { x: 0, y: nds.length > 0 ? maxY + 140 : 0 },
          data: { label, width },
          style: { width },
          width,
          height: NODE_HEIGHT_PX,
          dragHandle: DRAG_HANDLE_SELECTOR,
        },
      ];
    });
    onChange(createDiagramChange({ kind: "added", entity: "node", entityId: newId, label }));
  }, [onChange, setRfNodes]);

  // NOTE ON A REACT RULE: every callback below reads "current" node/edge/
  // selection state from a ref (or, for plain local state like
  // connectSourceId, a ref kept in sync the same way) and calls onChange
  // (which ultimately calls the caller's own setState, e.g. DiagramView's
  // setChanges) *before* calling any of this component's own setState
  // updaters — never from inside a setState updater function. Updater
  // functions must stay pure (React may invoke them more than once, e.g.
  // under StrictMode); calling another component's setState from inside one
  // is exactly what trips React's "Cannot update a component while
  // rendering a different component" warning, which earlier surfaced here
  // when onChange was called from inside setRfEdges/setRfNodes updaters.
  const onCommitLabel = useCallback(
    (id: string, nextLabel: string) => {
      const current = rfNodesRef.current.find((n) => n.id === id);
      if (!current || current.data.label === nextLabel) return;
      onChange(
        createDiagramChange({
          kind: "changed",
          entity: "node",
          entityId: id,
          label: nextLabel,
          detail: `label changed from "${current.data.label}" to "${nextLabel}"`,
        }),
      );
      setRfNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: nextLabel } } : n)));
    },
    [onChange, setRfNodes],
  );

  const onRemoveNode = useCallback(
    (id: string) => {
      const label = getNodeLabel(id);
      setRfNodes((nds) => nds.filter((n) => n.id !== id));
      setRfEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      onChange(createDiagramChange({ kind: "removed", entity: "node", entityId: id, label }));
    },
    [onChange, getNodeLabel, setRfNodes, setRfEdges],
  );

  const onActivateForConnect = useCallback(
    (id: string) => {
      const prevSource = connectSourceIdRef.current;
      if (!prevSource) {
        setConnectSourceId(id);
        return;
      }
      if (prevSource === id) {
        setConnectSourceId(null);
        return;
      }

      const alreadyConnected = rfEdgesRef.current.some((e) => e.source === prevSource && e.target === id);
      if (!alreadyConnected) {
        const edgeId = `edge-${prevSource}-${id}-${Date.now()}`;
        onChange(
          createDiagramChange({
            kind: "added",
            entity: "edge",
            entityId: edgeId,
            label: buildEdgeLabel(prevSource, id),
          }),
        );
        setRfEdges((eds) => [...eds, { id: edgeId, source: prevSource, target: id, type: "diagramEdge", data: {} }]);
      }
      setConnectMode(false);
      setConnectSourceId(null);
    },
    [onChange, buildEdgeLabel, setRfEdges],
  );

  const onSnipEdge = useCallback(
    (edgeId: string) => {
      const target = rfEdgesRef.current.find((e) => e.id === edgeId);
      if (!target) return;
      onChange(
        createDiagramChange({
          kind: "removed",
          entity: "edge",
          entityId: edgeId,
          label: buildEdgeLabel(target.source, target.target),
        }),
      );
      setRfEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setSelectedEdgeIds((prev) => {
        if (!prev.has(edgeId)) return prev;
        const next = new Set(prev);
        next.delete(edgeId);
        return next;
      });
    },
    [onChange, buildEdgeLabel, setRfEdges],
  );

  const onToggleEdgeSelection = useCallback((edgeId: string) => {
    setSelectedEdgeIds((prev) => {
      const next = new Set(prev);
      if (next.has(edgeId)) {
        next.delete(edgeId);
      } else {
        next.add(edgeId);
      }
      return next;
    });
  }, []);

  const deleteSelectedEdges = useCallback(() => {
    const toRemove = rfEdgesRef.current.filter((e) => selectedEdgeIds.has(e.id));
    for (const e of toRemove) {
      onChange(createDiagramChange({ kind: "removed", entity: "edge", entityId: e.id, label: buildEdgeLabel(e.source, e.target) }));
    }
    setRfEdges((eds) => eds.filter((e) => !selectedEdgeIds.has(e.id)));
    setSelectedEdgeIds(new Set());
  }, [onChange, buildEdgeLabel, selectedEdgeIds, setRfEdges]);

  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const handleNodeDragStart = useCallback((_event: unknown, node: DiagramFlowNode) => {
    dragStartPositions.current.set(node.id, { x: node.position.x, y: node.position.y });
  }, []);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: DiagramFlowNode) => {
      const start = dragStartPositions.current.get(node.id);
      dragStartPositions.current.delete(node.id);
      const change = buildMovedChange(node.id, node.data.label, start, { x: node.position.x, y: node.position.y });
      if (change) onChange(change);
    },
    [onChange],
  );

  /** Keyboard equivalent of handleNodeDragStop above (s1, consus-phase20):
   *  applies a fixed (dx, dy) step to the node's current position and runs
   *  it through the exact same buildMovedChange pure helper the pointer-drag
   *  path uses — same "is this a real move" threshold, same "moved" row
   *  shape — rather than a second, parallel implementation. */
  const onNudgeNode = useCallback(
    (id: string, dx: number, dy: number) => {
      const current = rfNodesRef.current.find((n) => n.id === id);
      if (!current) return;
      const start = { x: current.position.x, y: current.position.y };
      const end = { x: start.x + dx, y: start.y + dy };
      setRfNodes((nds) => nds.map((n) => (n.id === id ? { ...n, position: end } : n)));
      const change = buildMovedChange(id, current.data.label, start, end);
      if (change) onChange(change);
    },
    [onChange, setRfNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      const alreadyConnected = rfEdgesRef.current.some(
        (e) => e.source === connection.source && e.target === connection.target,
      );
      if (alreadyConnected) return;
      const edgeId = `edge-${connection.source}-${connection.target}-${Date.now()}`;
      setRfEdges((eds) => [
        ...eds,
        { id: edgeId, source: connection.source!, target: connection.target!, type: "diagramEdge", data: {} },
      ]);
      onChange(
        createDiagramChange({
          kind: "added",
          entity: "edge",
          entityId: edgeId,
          label: buildEdgeLabel(connection.source, connection.target),
        }),
      );
    },
    [onChange, buildEdgeLabel, setRfEdges],
  );

  const contextValue = useMemo<DiagramCanvasContextValue>(
    () => ({
      connectMode,
      connectSourceId,
      onActivateForConnect,
      onCommitLabel,
      onRemoveNode,
      edgeStyle,
      selectedEdgeIds,
      onSnipEdge,
      onToggleEdgeSelection,
      onNudgeNode,
      nodeLabelById,
      nodeRectById,
    }),
    [
      connectMode,
      connectSourceId,
      onActivateForConnect,
      onCommitLabel,
      onRemoveNode,
      edgeStyle,
      selectedEdgeIds,
      onSnipEdge,
      onToggleEdgeSelection,
      onNudgeNode,
      nodeLabelById,
      nodeRectById,
    ],
  );

  const toggleConnectMode = useCallback(() => {
    setConnectMode((v) => !v);
    setConnectSourceId(null);
  }, []);

  return (
    <div className="diagram-canvas" data-testid="diagram-canvas" data-edge-style={edgeStyle}>
      <div className="diagram-canvas__toolbar">
        <button type="button" onClick={addNode} data-testid="diagram-canvas-add-node">
          Add node
        </button>
        <button
          type="button"
          onClick={toggleConnectMode}
          aria-pressed={connectMode}
          className={connectMode ? "diagram-canvas__toolbar-btn--active" : undefined}
          data-testid="diagram-canvas-connect-toggle"
        >
          {connectMode ? (connectSourceId ? "Click target node…" : "Click source node…") : "Connect nodes"}
        </button>
        <button
          type="button"
          onClick={deleteSelectedEdges}
          disabled={selectedEdgeIds.size === 0}
          data-testid="diagram-canvas-delete-selected"
        >
          Delete selected ({selectedEdgeIds.size})
        </button>
      </div>
      <div className="diagram-canvas__flow">
        <DiagramCanvasContext.Provider value={contextValue}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onConnect={onConnect}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            fitView
          >
            <Background />
          </ReactFlow>
        </DiagramCanvasContext.Provider>
      </div>
    </div>
  );
}
