import type { ComponentProps } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ArchitectureDiagramView, buildArchitectureGraph } from "./ArchitectureDiagramView";

const TOP_LEVEL = 'graph TD\n  root["consus"]\n  root --> src["src"]\n  root --> server["server"]';
const FULL_COMPONENT = 'graph TD\n  root["consus"]\n  root --> src["src"]\n  src --> src_index["index.ts"]';

async function renderArchitectureView(props: Partial<ComponentProps<typeof ArchitectureDiagramView>> = {}) {
  const onProposeChange = vi.fn();
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <ArchitectureDiagramView
        repo="consus"
        topLevel={TOP_LEVEL}
        fullComponent={FULL_COMPONENT}
        onProposeChange={onProposeChange}
        {...props}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { ...utils, onProposeChange };
}

afterEach(() => {
  document.documentElement.style.removeProperty("--consus-edge-style");
});

describe("buildArchitectureGraph", () => {
  it("parses the topLevel source into nodes/edges with structurally-derived levels", () => {
    const graph = buildArchitectureGraph(TOP_LEVEL);
    expect(graph.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(["consus", "src", "server"]));
    const root = graph.nodes.find((n) => n.label === "consus")!;
    const src = graph.nodes.find((n) => n.label === "src")!;
    expect(root.level).toBe(0);
    expect(src.level).toBe(1);
    expect(graph.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: "root", target: "src" })]));
  });
});

describe("ArchitectureDiagramView", () => {
  it("renders given { repo, topLevel, fullComponent } props as an editable graph", async () => {
    await renderArchitectureView();

    expect(screen.getByText(/consus — architecture diagram/i)).toBeInTheDocument();
    expect(await screen.findByTestId("architecture-diagram-view-graph-top-level")).toBeInTheDocument();
    expect(screen.getByText("consus")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("switches to the full-component graph when that tab is selected", async () => {
    await renderArchitectureView();

    fireEvent.click(screen.getByRole("tab", { name: /full component/i }));

    expect(await screen.findByTestId("architecture-diagram-view-graph-full-component")).toBeInTheDocument();
    expect(screen.getByText("index.ts")).toBeInTheDocument();
  });

  it("does not import from DiagramView.tsx", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "ArchitectureDiagramView.tsx"), "utf-8");
    expect(source).not.toMatch(/from ["']\.\/DiagramView/);
  });

  describe("Fire to harness", () => {
    it("is not rendered at all when no onProposeChange handler is given", async () => {
      await renderArchitectureView({ onProposeChange: undefined });
      expect(screen.queryByRole("button", { name: /fire to harness/i })).not.toBeInTheDocument();
    });

    it("is disabled with zero pending changes", async () => {
      await renderArchitectureView();
      expect(screen.getByRole("button", { name: /fire to harness/i })).toBeDisabled();
    });

    it("becomes enabled after an edit and fires a computed diff + description", async () => {
      const { onProposeChange } = await renderArchitectureView();

      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));
      expect(screen.getByRole("button", { name: /fire to harness/i })).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

      expect(onProposeChange).toHaveBeenCalledTimes(1);
      const call = onProposeChange.mock.calls[0][0];
      expect(call.diff).toContain("+ node New node 1");
      expect(call.description).toMatch(/1 change/);
    });
  });

  describe("changeset + both edge-deletion paths", () => {
    it("logs an 'added' row for the connect flow", async () => {
      await renderArchitectureView();

      fireEvent.click(screen.getByTestId("diagram-canvas-connect-toggle"));
      fireEvent.click(screen.getByTestId("diagram-node-label-src"));
      fireEvent.click(screen.getByTestId("diagram-node-label-server"));

      expect(screen.getByTestId("changeset-row-added")).toHaveTextContent("src -> server");
    });

    it("path 1: direct click on a connector removes it and logs a 'removed' row", async () => {
      await renderArchitectureView();

      const edge = document.querySelector('[data-source="root"][data-target="src"]');
      expect(edge).not.toBeNull();
      fireEvent.click(edge!);

      expect(screen.getByTestId("changeset-row-removed")).toBeInTheDocument();
      expect(edge).not.toBeInTheDocument();
    });

    it("path 2: shift-click to select, then 'Delete selected' removes it independently of path 1", async () => {
      await renderArchitectureView();

      const edge = document.querySelector('[data-source="root"][data-target="server"]');
      fireEvent.click(edge!, { shiftKey: true });
      expect(screen.getByTestId("diagram-canvas-delete-selected")).toBeEnabled();

      fireEvent.click(screen.getByTestId("diagram-canvas-delete-selected"));

      expect(screen.getByTestId("changeset-row-removed")).toBeInTheDocument();
      expect(edge).not.toBeInTheDocument();
    });
  });

  describe("per-tab dirty state", () => {
    it("reports the combined pending count across both sub-views via onPendingChangesChange", async () => {
      const onPendingChangesChange = vi.fn();
      await renderArchitectureView({ onPendingChangesChange });

      onPendingChangesChange.mockClear();
      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));

      expect(onPendingChangesChange).toHaveBeenCalledWith(1);
    });

    it("shows a dirty dot once there's a pending change, none when clean", async () => {
      await renderArchitectureView();
      expect(screen.queryByTestId("diagram-dirty-dot")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));

      expect(screen.getByTestId("diagram-dirty-dot")).toBeInTheDocument();
    });
  });

  describe("skin-resolved edge style", () => {
    it("renders organic edges for Case Board", async () => {
      document.documentElement.style.setProperty("--consus-edge-style", "organic");
      await renderArchitectureView();
      const edge = document.querySelector('[data-source="root"][data-target="src"]');
      expect(edge?.getAttribute("d")).toContain("Q");
    });

    it("renders straight edges for Drafting Table / Harness", async () => {
      document.documentElement.style.setProperty("--consus-edge-style", "straight");
      await renderArchitectureView();
      const edge = document.querySelector('[data-source="root"][data-target="src"]');
      expect(edge?.getAttribute("d")).not.toContain("Q");
    });
  });

  describe("collapsible Mermaid source panel (s3) — same mechanism as DiagramView", () => {
    it("is closed by default and shows live graph TD source once toggled open", async () => {
      await renderArchitectureView();

      expect(screen.queryByTestId("diagram-source-panel-text")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));

      const text = screen.getByTestId("diagram-source-panel-text");
      expect(text).toHaveTextContent("graph TD");
      expect(text).toHaveTextContent("consus");
      expect(text).toHaveTextContent("src");
    });

    it("regenerates after a real add-node edit, without closing/reopening", async () => {
      await renderArchitectureView();
      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));

      fireEvent.click(screen.getByTestId("diagram-canvas-add-node"));

      expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("New node 1");
    });

    it("switches to the newly active tab's own live source when the tab changes", async () => {
      await renderArchitectureView();
      fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));
      expect(screen.getByTestId("diagram-source-panel-text")).not.toHaveTextContent("index.ts");

      fireEvent.click(screen.getByRole("tab", { name: /full component/i }));

      expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("index.ts");
    });

    it("renders identically in structure across all 3 skins", async () => {
      for (const skin of ["drafting", "case-board", "harness"] as const) {
        document.documentElement.setAttribute("data-skin", skin);
        const { unmount } = await renderArchitectureView();

        expect(screen.getByTestId("diagram-source-panel-toggle")).toBeInTheDocument();
        fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));
        expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("graph TD");

        unmount();
        document.documentElement.removeAttribute("data-skin");
      }
    });
  });

  describe("6+ sibling regression guard (directory graph shape)", () => {
    it("renders 8 top-level directories with no label truncation or overlap", async () => {
      const dirs = ["server", "web", "docs", "scripts", "config", "tests", "assets", "tools"];
      const manySource = ["graph TD", '  root["consus"]', ...dirs.map((d) => `  root --> ${d}["${d}"]`)].join("\n");

      await renderArchitectureView({ topLevel: manySource });

      const boxes = dirs.map((d) => {
        const el = screen.getByTestId(`diagram-node-${d}`);
        expect(el).toHaveTextContent(d);
        const wrapper = el.parentElement!;
        const x = Number(wrapper.style.transform.match(/translate\(([-\d.]+)px/)?.[1] ?? NaN);
        const width = parseFloat(el.style.width);
        return { x, width };
      });

      const sorted = [...boxes].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].width);
      }
    });
  });
});
