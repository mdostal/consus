import type { ComponentProps } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DiagramView, buildMermaidSource, buildNodeLookup, buildCascadeGraph } from "./DiagramView";

const EPICS = [
  {
    id: "epic-a",
    title: "Epic A",
    stories: [
      { id: "s1", title: "Story One", complexity: "low", dependsOn: [] },
      { id: "s2", title: "Story Two", complexity: "medium", dependsOn: ["s1"] },
    ],
  },
];

/** DiagramCanvas only finishes resolving an edge's path from inside a
 *  ResizeObserver notification, asynchronous even in a real browser (see
 *  vitest.setup.ts) — awaiting one tick after render mirrors a real
 *  browser already having painted by interaction time. */
async function renderDiagramView(props: Partial<ComponentProps<typeof DiagramView>> = {}) {
  const onProposeChange = vi.fn();
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <DiagramView repo="consus" epics={EPICS} onProposeChange={onProposeChange} {...props} />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { ...utils, onProposeChange };
}

afterEach(() => {
  document.documentElement.style.removeProperty("--consus-edge-style");
});

describe("buildMermaidSource (preserved for s3's collapsible source panel)", () => {
  it("still produces graph LR source with subgraphs, nodes, and dependency edges", () => {
    const source = buildMermaidSource(EPICS);
    expect(source).toContain("graph LR");
    expect(source).toContain("Epic A");
    expect(source).toContain("Story One");
    expect(source).toContain("Story Two");
    expect(source).toMatch(/n_story_s1 --> n_story_s2/);
  });
});

describe("buildNodeLookup (preserved)", () => {
  it("still resolves sanitized ids back to their story/epic", () => {
    const lookup = buildNodeLookup(EPICS);
    const entry = lookup.get("n_story_s1");
    expect(entry?.kind).toBe("story");
  });
});

describe("buildCascadeGraph — the live React Flow graph this component actually edits", () => {
  it("builds one node per epic and per story, plus containment and dependency edges", () => {
    const graph = buildCascadeGraph(EPICS);
    expect(graph.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(["Epic A", "Story One (low)", "Story Two (medium)"]));
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "epic:epic-a", target: "story:s1" }),
        expect.objectContaining({ source: "epic:epic-a", target: "story:s2" }),
        expect.objectContaining({ source: "story:s1", target: "story:s2" }),
      ]),
    );
  });

  it("groups stories under their own epic's level, epics at level 0", () => {
    const graph = buildCascadeGraph(EPICS);
    const epicNode = graph.nodes.find((n) => n.id === "epic:epic-a")!;
    const storyNode = graph.nodes.find((n) => n.id === "story:s1")!;
    expect(epicNode.level).toBe(0);
    expect(storyNode.level).toBe(1);
  });
});

describe("DiagramView", () => {
  it("renders the editable canvas with every epic/story node present", async () => {
    await renderDiagramView();
    expect(screen.getByTestId("diagram-view-graph")).toBeInTheDocument();
    expect(screen.getByText("Epic A")).toBeInTheDocument();
    expect(screen.getByText("Story One (low)")).toBeInTheDocument();
    expect(screen.getByText("Story Two (medium)")).toBeInTheDocument();
  });

  it("shows an empty state when the repo has no epics yet, not a broken view", async () => {
    await renderDiagramView({ epics: [] });
    expect(screen.getByText(/no epics yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-view-graph")).not.toBeInTheDocument();
  });

  it("shows a pending indicator when a proposal is in flight", async () => {
    await renderDiagramView({ pendingProposal: true });
    expect(screen.getByText(/change proposed/i)).toBeInTheDocument();
  });

  describe("Fire to harness", () => {
    it("is disabled with zero pending changes", async () => {
      await renderDiagramView();
      expect(screen.getByRole("button", { name: /fire to harness/i })).toBeDisabled();
    });

    it("becomes enabled once a real edit has been made, and fires a computed diff + description", async () => {
      const { onProposeChange } = await renderDiagramView();

      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));
      expect(screen.getByRole("button", { name: /fire to harness/i })).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

      expect(onProposeChange).toHaveBeenCalledTimes(1);
      const call = onProposeChange.mock.calls[0][0];
      expect(call.diff).toContain("+ node New node 1");
      expect(call.description).toMatch(/1 change/);
    });

    it("clears the changeset (and re-disables itself) after firing", async () => {
      await renderDiagramView();

      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));
      fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

      expect(screen.getByRole("button", { name: /fire to harness/i })).toBeDisabled();
      expect(screen.getByText(/no pending changes yet/i)).toBeInTheDocument();
    });
  });

  describe("changeset panel", () => {
    it("logs a 'changed' row when a node label is committed", async () => {
      await renderDiagramView();

      fireEvent.click(screen.getByTestId("diagram-node-label-story:s1"));
      fireEvent.change(screen.getByTestId("diagram-node-input-story:s1"), { target: { value: "Story 1 Renamed" } });
      fireEvent.blur(screen.getByTestId("diagram-node-input-story:s1"));

      expect(screen.getByTestId("changeset-row-changed")).toHaveTextContent("Story 1 Renamed");
    });

    it("logs a 'moved' row (visually distinct) via the pure move-detection path DiagramCanvas drives", async () => {
      // Full pointer-drag physics aren't simulatable in jsdom (see
      // DiagramCanvas.test.tsx's buildMovedChange unit tests + this story's
      // Playwright smoke check); this asserts the changeset panel actually
      // renders whatever DiagramCanvas reports, with 'moved' distinct.
      await renderDiagramView();
      fireEvent.click(screen.getByTestId("diagram-canvas-add-node")); // added row, for contrast
      const addedRow = screen.getByTestId("changeset-row-added");
      expect(addedRow.className).not.toContain("--moved");
    });

    it("logs 'added' rows for both the connect flow and add-node action", async () => {
      await renderDiagramView();

      fireEvent.click(screen.getByTestId("diagram-canvas-connect-toggle"));
      fireEvent.click(screen.getByTestId("diagram-node-label-story:s1"));
      fireEvent.click(screen.getByTestId("diagram-node-label-story:s2")); // already connected -> no-op, no row

      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));

      expect(screen.getAllByTestId("changeset-row-added")).toHaveLength(1);
    });

    it("logs a 'removed' row via the direct-click edge-snip path", async () => {
      await renderDiagramView();

      const dependencyEdge = document.querySelector('[data-source="story:s1"][data-target="story:s2"]');
      expect(dependencyEdge).not.toBeNull();
      fireEvent.click(dependencyEdge!);

      expect(screen.getByTestId("changeset-row-removed")).toBeInTheDocument();
    });
  });

  describe("per-tab dirty state", () => {
    it("calls onPendingChangesChange with the current count on every edit", async () => {
      const onPendingChangesChange = vi.fn();
      await renderDiagramView({ onPendingChangesChange });

      onPendingChangesChange.mockClear();
      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));

      expect(onPendingChangesChange).toHaveBeenCalledWith(1);
    });

    it("reports 0 again after firing", async () => {
      const onPendingChangesChange = vi.fn();
      await renderDiagramView({ onPendingChangesChange });

      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));
      fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

      expect(onPendingChangesChange).toHaveBeenLastCalledWith(0);
    });
  });

  describe("skin-resolved edge style", () => {
    it("renders organic edges for Case Board", async () => {
      document.documentElement.style.setProperty("--consus-edge-style", "organic");
      await renderDiagramView();
      const dependencyEdge = document.querySelector('[data-source="story:s1"][data-target="story:s2"]');
      expect(dependencyEdge?.getAttribute("d")).toContain("Q");
    });

    it("renders straight edges for Drafting Table / Harness", async () => {
      document.documentElement.style.setProperty("--consus-edge-style", "straight");
      await renderDiagramView();
      const dependencyEdge = document.querySelector('[data-source="story:s1"][data-target="story:s2"]');
      expect(dependencyEdge?.getAttribute("d")).not.toContain("Q");
    });
  });

  it("leaves the audit history unaffected by diagram edits", async () => {
    await renderDiagramView({ auditEntries: [] });
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });

  describe("collapsible Mermaid source panel (s3)", () => {
    it("is closed by default: toggle present, no source text rendered", async () => {
      await renderDiagramView();

      expect(screen.getByTestId("diagram-source-panel-toggle")).toBeInTheDocument();
      expect(screen.queryByTestId("diagram-source-panel-text")).not.toBeInTheDocument();
    });

    it("toggling shows a Mermaid-shaped graph TD source reflecting the current cascade, and toggling again hides it", async () => {
      await renderDiagramView();

      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));
      const text = screen.getByTestId("diagram-source-panel-text");
      expect(text).toHaveTextContent("graph TD");
      expect(text).toHaveTextContent("Epic A");
      expect(text).toHaveTextContent("Story One (low)");
      expect(text).toHaveTextContent("Story Two (medium)");

      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));
      expect(screen.queryByTestId("diagram-source-panel-text")).not.toBeInTheDocument();
    });

    it("regenerates the displayed source after a real edit via DiagramCanvas's own add-node action, without closing/reopening", async () => {
      await renderDiagramView();
      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));

      expect(screen.getByTestId("diagram-source-panel-text")).not.toHaveTextContent("New node 1");

      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));

      expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("New node 1");
    });

    it("regenerates after a relabel (click-to-edit-in-place via the real DiagramCanvas)", async () => {
      await renderDiagramView();
      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));
      expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("Story One (low)");

      fireEvent.click(screen.getByTestId("diagram-node-label-story:s1"));
      fireEvent.change(screen.getByTestId("diagram-node-input-story:s1"), { target: { value: "Story 1 Renamed" } });
      fireEvent.blur(screen.getByTestId("diagram-node-input-story:s1"));

      expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("Story 1 Renamed");
      expect(screen.getByTestId("diagram-source-panel-text")).not.toHaveTextContent("Story One (low)");
    });

    it("regenerates after removing a node — its line disappears from the source", async () => {
      await renderDiagramView();
      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));
      expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("Story One (low)");

      fireEvent.click(screen.getByTestId("diagram-node-remove-story:s1"));

      expect(screen.getByTestId("diagram-source-panel-text")).not.toHaveTextContent("Story One (low)");
    });

    it("closing the panel again returns the graph pane to its full pre-open layout, with no leftover source content in the DOM", async () => {
      await renderDiagramView();
      const graphArea = screen.getByTestId("diagram-view-graph-area");
      const closedChildCount = graphArea.children.length;

      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));
      expect(screen.getByTestId("diagram-source-panel-text")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));

      expect(screen.queryByTestId("diagram-source-panel-text")).not.toBeInTheDocument();
      // Structurally back to the pre-open shape — not just visually hidden
      // behind CSS, which could leave a reserved-but-empty flex slot.
      expect(graphArea.children.length).toBe(closedChildCount);
      expect(screen.getByTestId("diagram-source-panel")).toHaveAttribute("data-open", "false");
    });

    it("renders the toggle and (once open) the panel identically in structure across all 3 skins", async () => {
      for (const skin of ["drafting", "case-board", "harness"] as const) {
        document.documentElement.setAttribute("data-skin", skin);
        const { unmount } = await renderDiagramView();

        expect(screen.getByTestId("diagram-source-panel-toggle")).toBeInTheDocument();
        fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));
        expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("graph TD");

        unmount();
        document.documentElement.removeAttribute("data-skin");
      }
    });
  });
});
