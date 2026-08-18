import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DiagramCanvas, buildMovedChange, type DiagramCanvasNodeInput, type DiagramCanvasEdgeInput } from "./DiagramCanvas";
import type { DiagramChange } from "./diagramDiff";

const NODES: DiagramCanvasNodeInput[] = [
  { id: "a", label: "Story One", level: 0 },
  { id: "b", label: "Story Two", level: 0 },
  { id: "c", label: "Story Three", level: 0 },
];

const EDGES: DiagramCanvasEdgeInput[] = [{ id: "e1", source: "a", target: "b" }];

/** @xyflow/react only finishes resolving each node's handle position (and
 *  therefore whether an edge between two nodes has a real path at all)
 *  from inside an actual ResizeObserver notification — asynchronous even
 *  in a real browser (see vitest.setup.ts). Awaiting one tick here mirrors
 *  a real browser already having painted by the time an operator can click
 *  anything in a rendered diagram. */
async function renderCanvas(nodes = NODES, edges = EDGES) {
  const changes: DiagramChange[] = [];
  const onChange = vi.fn((c: DiagramChange) => changes.push(c));
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<DiagramCanvas nodes={nodes} edges={edges} onChange={onChange} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { ...utils, onChange, changes };
}

afterEach(() => {
  document.documentElement.style.removeProperty("--consus-edge-style");
});

describe("buildMovedChange — drag-by-handle move detection (pure logic underlying handleNodeDragStop)", () => {
  it("logs a 'moved' row when the end position differs from the start position", () => {
    const change = buildMovedChange("a", "Story One", { x: 0, y: 0 }, { x: 120, y: 340 });
    expect(change).toEqual(
      expect.objectContaining({ kind: "moved", entity: "node", entityId: "a", label: "Story One", detail: "moved to (120, 340)" }),
    );
  });

  it("does not log a move for a no-op drag (handle clicked but never displaced)", () => {
    expect(buildMovedChange("a", "Story One", { x: 50, y: 50 }, { x: 50, y: 50 })).toBeNull();
  });

  it("does not log a move for sub-pixel jitter", () => {
    expect(buildMovedChange("a", "Story One", { x: 50, y: 50 }, { x: 50.4, y: 49.7 })).toBeNull();
  });

  it("returns null when there was no recorded drag start (defensive: drag-stop without a matching drag-start)", () => {
    expect(buildMovedChange("a", "Story One", undefined, { x: 10, y: 10 })).toBeNull();
  });

  it("logs a move for a real single-axis displacement too", () => {
    expect(buildMovedChange("a", "Story One", { x: 0, y: 0 }, { x: 0, y: 200 })).not.toBeNull();
  });
});

describe("DiagramCanvas — rendering", () => {
  it("renders every node's full label, unclipped, with no two same-level nodes overlapping (6+ sibling regression guard)", async () => {
    const many: DiagramCanvasNodeInput[] = [
      { id: "n1", label: "server/decision-contra", level: 0 },
      { id: "n2", label: "server/li", level: 0 },
      { id: "n3", label: "server/harness/transport", level: 0 },
      { id: "n4", label: "server/routes/proposals", level: 0 },
      { id: "n5", label: "server/routes/diagrams", level: 0 },
      { id: "n6", label: "server/lib/diagram-generator", level: 0 },
      { id: "n7", label: "web/src/features/projects", level: 0 },
    ];
    await renderCanvas(many, []);

    const boxes = many.map((n) => {
      const el = screen.getByTestId(`diagram-node-${n.id}`);
      expect(el).toHaveTextContent(n.label); // full label present, not truncated
      const x = Number((el as HTMLElement).parentElement?.style.transform?.match(/translate\(([-\d.]+)px/)?.[1] ?? NaN);
      const width = parseFloat(el.style.width);
      return { id: n.id, x, width };
    });

    const sorted = [...boxes].sort((x, y) => x.x - y.x);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      // no overlap: current node starts at or after the previous node's right edge
      expect(curr.x).toBeGreaterThanOrEqual(prev.x + prev.width);
    }
  });
});

describe("DiagramCanvas — click-to-edit label", () => {
  it("clicking a node's label (not its drag handle) makes it editable, and committing logs a 'changed' row", async () => {
    const { onChange } = await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-node-label-a"));
    const input = screen.getByTestId("diagram-node-input-a");
    fireEvent.change(input, { target: { value: "Story 1 Renamed" } });
    fireEvent.blur(input);

    expect(screen.getByTestId("diagram-node-label-a")).toHaveTextContent("Story 1 Renamed");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "changed", entity: "node", entityId: "a", label: "Story 1 Renamed" }),
    );
  });

  it("committing an unchanged label does not log a change", async () => {
    const { onChange } = await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-node-label-a"));
    fireEvent.blur(screen.getByTestId("diagram-node-input-a"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("pressing Escape cancels the edit without logging a change", async () => {
    const { onChange } = await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-node-label-a"));
    fireEvent.change(screen.getByTestId("diagram-node-input-a"), { target: { value: "Whoops" } });
    fireEvent.keyDown(screen.getByTestId("diagram-node-input-a"), { key: "Escape" });

    expect(screen.getByTestId("diagram-node-label-a")).toHaveTextContent("Story One");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DiagramCanvas — add node", () => {
  it("the add-node action creates a new node and logs an 'added' row", async () => {
    const { onChange } = await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "added", entity: "node" }));
    expect(screen.getAllByText(/^New node \d+$/)[0]).toBeInTheDocument();
  });
});

describe("DiagramCanvas — connect flow", () => {
  it("connect mode: clicking a source then a target node with no existing edge draws a new edge and logs an 'added' row", async () => {
    const { onChange } = await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-canvas-connect-toggle"));
    fireEvent.click(screen.getByTestId("diagram-node-label-b")); // source
    fireEvent.click(screen.getByTestId("diagram-node-label-c")); // target

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "added", entity: "edge", label: "Story Two -> Story Three" }),
    );
  });

  it("exits connect mode after completing a connection", async () => {
    await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-canvas-connect-toggle"));
    fireEvent.click(screen.getByTestId("diagram-node-label-b"));
    fireEvent.click(screen.getByTestId("diagram-node-label-c"));

    expect(screen.getByTestId("diagram-canvas-connect-toggle")).toHaveTextContent("Connect nodes");
  });

  it("clicking a node while not in connect mode edits it rather than starting a connection", async () => {
    const { onChange } = await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-node-label-a"));
    expect(screen.getByTestId("diagram-node-input-a")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not create a duplicate edge for an already-connected pair", async () => {
    const { onChange } = await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-canvas-connect-toggle"));
    fireEvent.click(screen.getByTestId("diagram-node-label-a")); // a already -> b
    fireEvent.click(screen.getByTestId("diagram-node-label-b"));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DiagramCanvas — edge deletion, both paths", () => {
  it("path 1: clicking a connector directly removes it and logs a 'removed' row", async () => {
    const { onChange } = await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-edge-e1"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "removed", entity: "edge", entityId: "e1", label: "Story One -> Story Two" }),
    );
    expect(screen.queryByTestId("diagram-edge-e1")).not.toBeInTheDocument();
  });

  it("path 2: shift-click selects without deleting, and 'Delete selected' removes it and logs a 'removed' row", async () => {
    const { onChange } = await renderCanvas();

    expect(screen.getByTestId("diagram-canvas-delete-selected")).toBeDisabled();

    fireEvent.click(screen.getByTestId("diagram-edge-e1"), { shiftKey: true });
    expect(screen.getByTestId("diagram-edge-e1")).toBeInTheDocument(); // still present, not snipped
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("diagram-canvas-delete-selected")).toBeEnabled();

    fireEvent.click(screen.getByTestId("diagram-canvas-delete-selected"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "removed", entity: "edge", entityId: "e1" }),
    );
    expect(screen.queryByTestId("diagram-edge-e1")).not.toBeInTheDocument();
  });

  it("shift-clicking a second time deselects without deleting", async () => {
    await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-edge-e1"), { shiftKey: true });
    fireEvent.click(screen.getByTestId("diagram-edge-e1"), { shiftKey: true });

    expect(screen.getByTestId("diagram-canvas-delete-selected")).toBeDisabled();
  });

  it("both deletion paths work independently: a plain click still snips even after a shift-click selection elsewhere", async () => {
    const twoEdges: DiagramCanvasEdgeInput[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
    ];
    const { onChange } = await renderCanvas(NODES, twoEdges);

    fireEvent.click(screen.getByTestId("diagram-edge-e2"), { shiftKey: true }); // select e2, don't delete
    fireEvent.click(screen.getByTestId("diagram-edge-e1")); // plain click: snip e1 directly

    expect(screen.queryByTestId("diagram-edge-e1")).not.toBeInTheDocument();
    expect(screen.getByTestId("diagram-edge-e2")).toBeInTheDocument(); // untouched by the direct-click path
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "removed", entityId: "e1" }));
  });
});

describe("DiagramCanvas — skin-resolved edge style", () => {
  it("renders organic (curved) edges for Case Board's --consus-edge-style token", async () => {
    document.documentElement.style.setProperty("--consus-edge-style", "organic");
    await renderCanvas();
    const path = screen.getByTestId("diagram-edge-e1").getAttribute("d");
    expect(path).toContain("Q");
  });

  it("renders straight/orthogonal edges for Drafting Table / Harness's token value", async () => {
    document.documentElement.style.setProperty("--consus-edge-style", "straight");
    await renderCanvas();
    const path = screen.getByTestId("diagram-edge-e1").getAttribute("d");
    expect(path).not.toContain("Q");
  });
});

describe("DiagramCanvas — onLiveStateChange (s3: read-out for the collapsible source panel)", () => {
  it("is optional — omitting it entirely does not crash any interaction", async () => {
    const changes: DiagramChange[] = [];
    await act(async () => {
      render(<DiagramCanvas nodes={NODES} edges={EDGES} onChange={(c) => changes.push(c)} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(() => fireEvent.click(screen.getByTestId("diagram-canvas-add-node"))).not.toThrow();
  });

  it("fires once on mount with the initial node/edge state", async () => {
    const onLiveStateChange = vi.fn();
    await act(async () => {
      render(<DiagramCanvas nodes={NODES} edges={EDGES} onChange={() => {}} onLiveStateChange={onLiveStateChange} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onLiveStateChange).toHaveBeenCalled();
    const [lastNodes, lastEdges] = onLiveStateChange.mock.calls[onLiveStateChange.mock.calls.length - 1];
    expect(lastNodes.map((n: DiagramCanvasNodeInput) => n.label)).toEqual(
      expect.arrayContaining(["Story One", "Story Two", "Story Three"]),
    );
    expect(lastEdges).toEqual(expect.arrayContaining([expect.objectContaining({ id: "e1", source: "a", target: "b" })]));
  });

  it("fires again, with the updated state, after add-node/relabel/remove/connect edits", async () => {
    const onLiveStateChange = vi.fn();
    await act(async () => {
      render(<DiagramCanvas nodes={NODES} edges={EDGES} onChange={() => {}} onLiveStateChange={onLiveStateChange} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    onLiveStateChange.mockClear();

    fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));

    expect(onLiveStateChange).toHaveBeenCalled();
    const [lastNodes] = onLiveStateChange.mock.calls[onLiveStateChange.mock.calls.length - 1];
    expect(lastNodes.map((n: DiagramCanvasNodeInput) => n.label)).toEqual(expect.arrayContaining(["New node 1"]));
  });

  it("this is a read-out only — it never receives anything DiagramCanvas didn't itself already decide to change; it is not called at all in response to an unrelated re-render with no edit", async () => {
    const onLiveStateChange = vi.fn();
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      utils = render(<DiagramCanvas nodes={NODES} edges={EDGES} onChange={() => {}} onLiveStateChange={onLiveStateChange} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    onLiveStateChange.mockClear();

    // Re-rendering with the exact same props (no edit happened) shouldn't
    // spuriously re-fire the live-state broadcast.
    await act(async () => {
      utils.rerender(<DiagramCanvas nodes={NODES} edges={EDGES} onChange={() => {}} onLiveStateChange={onLiveStateChange} />);
    });

    expect(onLiveStateChange).not.toHaveBeenCalled();
  });
});

describe("DiagramCanvas — node removal (bonus symmetry with add-node)", () => {
  it("removing a node logs a 'removed' row and drops its own edges", async () => {
    const { onChange } = await renderCanvas();

    fireEvent.click(screen.getByTestId("diagram-node-remove-a"));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "removed", entity: "node", entityId: "a" }));
    expect(screen.queryByTestId("diagram-node-a")).not.toBeInTheDocument();
    expect(screen.queryByTestId("diagram-edge-e1")).not.toBeInTheDocument(); // a->b edge dropped too
  });
});

describe("DiagramCanvas — keyboard-accessible node move (consus-phase20 s1)", () => {
  it("the drag handle is a real focusable element with the existing aria-label as its accessible name", async () => {
    await renderCanvas();

    const handle = screen.getByTestId("diagram-node-drag-handle-a");
    expect(handle).toHaveAttribute("tabIndex", "0");
    expect(handle).toHaveAccessibleName("Move Story One");
  });

  it("pressing an arrow key while the drag handle has focus visibly moves the node and logs a 'moved' row — same shape as a pointer drag (kind/entity/entityId/label, see buildMovedChange above)", async () => {
    const { onChange } = await renderCanvas();

    const handle = screen.getByTestId("diagram-node-drag-handle-a");
    const nodeEl = screen.getByTestId("diagram-node-a");
    const wrapper = nodeEl.parentElement as HTMLElement;
    const beforeX = Number(wrapper.style.transform?.match(/translate\(([-\d.]+)px/)?.[1] ?? NaN);

    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    const afterX = Number(wrapper.style.transform?.match(/translate\(([-\d.]+)px/)?.[1] ?? NaN);
    expect(afterX).toBeGreaterThan(beforeX); // a real, visible move happened

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "moved", entity: "node", entityId: "a", label: "Story One" }),
    );
  });

  it("arrow-key move works in all four directions", async () => {
    const { onChange } = await renderCanvas();
    const handle = screen.getByTestId("diagram-node-drag-handle-a");
    handle.focus();

    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      fireEvent.keyDown(handle, { key });
    }

    expect(onChange).toHaveBeenCalledTimes(4);
    for (const call of onChange.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ kind: "moved", entity: "node", entityId: "a" }));
    }
  });

  it("a non-arrow key on the focused drag handle does nothing", async () => {
    const { onChange } = await renderCanvas();
    const handle = screen.getByTestId("diagram-node-drag-handle-a");
    handle.focus();

    fireEvent.keyDown(handle, { key: "a" });

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DiagramCanvas — keyboard-accessible edge delete (consus-phase20 s1)", () => {
  it("the edge path is a real focusable element with an accessible name describing what it connects", async () => {
    await renderCanvas();

    const edge = screen.getByTestId("diagram-edge-e1");
    // SVG attribute names are case-sensitive (unlike HTML's), so React
    // renders this as the lowercase "tabindex" DOM attribute here — assert
    // it that way rather than the "tabIndex" spelling used for the (HTML)
    // drag handle above.
    expect(edge).toHaveAttribute("tabindex", "0");
    expect(edge).toHaveAccessibleName("Connection from Story One to Story Two");
  });

  it("pressing Enter on a focused edge removes it exactly as a click would — same ctx.onSnipEdge call, same 'removed' row shape as the click-to-snip test above", async () => {
    const { onChange } = await renderCanvas();

    const edge = screen.getByTestId("diagram-edge-e1");
    edge.focus();
    fireEvent.keyDown(edge, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "removed", entity: "edge", entityId: "e1", label: "Story One -> Story Two" }),
    );
    expect(screen.queryByTestId("diagram-edge-e1")).not.toBeInTheDocument();
  });

  it("pressing Space on a focused edge also removes it, same as Enter", async () => {
    const { onChange } = await renderCanvas();

    const edge = screen.getByTestId("diagram-edge-e1");
    edge.focus();
    fireEvent.keyDown(edge, { key: " " });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "removed", entity: "edge", entityId: "e1", label: "Story One -> Story Two" }),
    );
    expect(screen.queryByTestId("diagram-edge-e1")).not.toBeInTheDocument();
  });

  it("a non-Enter/Space key on the focused edge does nothing", async () => {
    const { onChange } = await renderCanvas();

    const edge = screen.getByTestId("diagram-edge-e1");
    edge.focus();
    fireEvent.keyDown(edge, { key: "a" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("diagram-edge-e1")).toBeInTheDocument();
  });
});
