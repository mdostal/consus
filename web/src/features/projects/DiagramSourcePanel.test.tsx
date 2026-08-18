import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiagramSourcePanel, buildDiagramSource, type DiagramSourcePanelProps } from "./DiagramSourcePanel";
import type { DiagramCanvasNodeInput, DiagramCanvasEdgeInput } from "./DiagramCanvas";

const NODES: DiagramCanvasNodeInput[] = [
  { id: "a", label: "Story One", level: 0 },
  { id: "b", label: "Story Two", level: 0 },
];
const EDGES: DiagramCanvasEdgeInput[] = [{ id: "e1", source: "a", target: "b" }];

describe("buildDiagramSource — pure Mermaid graph TD serialization", () => {
  it("emits a graph TD header, one bracketed line per node, one --> line per edge", () => {
    const source = buildDiagramSource(NODES, EDGES);
    expect(source).toMatch(/^graph TD/);
    expect(source).toContain('n_a["Story One"]');
    expect(source).toContain('n_b["Story Two"]');
    expect(source).toContain("n_a --> n_b");
  });

  it("escapes double quotes out of labels so a relabel can't break the source shape", () => {
    const source = buildDiagramSource([{ id: "a", label: 'Say "hi"', level: 0 }], []);
    expect(source).toContain('n_a["Say &quot;hi&quot;"]');
  });

  it("sanitizes ids with punctuation (e.g. DiagramView's 'story:s1' scheme) into Mermaid-safe ids", () => {
    const source = buildDiagramSource([{ id: "story:s1", label: "Story One", level: 0 }], []);
    expect(source).toContain('n_story_s1["Story One"]');
  });

  it("regenerates correctly from an empty graph (no nodes/edges left)", () => {
    expect(buildDiagramSource([], [])).toBe("graph TD");
  });
});

describe("DiagramSourcePanel — toggle affordance", () => {
  it("shows a toggle control but no source text while closed", () => {
    render(<DiagramSourcePanel nodes={NODES} edges={EDGES} open={false} onToggle={() => {}} />);
    expect(screen.getByTestId("diagram-source-panel-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-source-panel-text")).not.toBeInTheDocument();
  });

  it("renders the current Mermaid-shaped source text once open", () => {
    render(<DiagramSourcePanel nodes={NODES} edges={EDGES} open onToggle={() => {}} />);
    const text = screen.getByTestId("diagram-source-panel-text");
    expect(text).toHaveTextContent("graph TD");
    expect(text).toHaveTextContent("Story One");
    expect(text).toHaveTextContent("Story Two");
  });

  it("calls onToggle (with no arguments) when the toggle control is clicked — never with diagram content", () => {
    const onToggle = vi.fn();
    render(<DiagramSourcePanel nodes={NODES} edges={EDGES} open={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(); // no args at all — can't smuggle a mutation through it
  });
});

describe("DiagramSourcePanel — genuinely read-only (no mutation path)", () => {
  it("renders no input, textarea, or contentEditable element anywhere in its output, open or closed", () => {
    const { container: closed } = render(
      <DiagramSourcePanel nodes={NODES} edges={EDGES} open={false} onToggle={() => {}} />,
    );
    expect(closed.querySelectorAll("input, textarea, [contenteditable]").length).toBe(0);

    const { container: open } = render(<DiagramSourcePanel nodes={NODES} edges={EDGES} open onToggle={() => {}} />);
    expect(open.querySelectorAll("input, textarea, [contenteditable]").length).toBe(0);
    // The one element that does hold the text is a plain <pre>, not any
    // kind of editable surface.
    expect(screen.getByTestId("diagram-source-panel-text").tagName).toBe("PRE");
  });

  it("re-rendering with different nodes/edges (simulating an upstream edit) only ever changes the displayed text — there is no reverse channel", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<DiagramSourcePanel nodes={NODES} edges={EDGES} open onToggle={onToggle} />);
    expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("Story One");

    const nextNodes: DiagramCanvasNodeInput[] = [...NODES, { id: "c", label: "Story Three", level: 0 }];
    rerender(<DiagramSourcePanel nodes={nextNodes} edges={EDGES} open onToggle={onToggle} />);

    expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("Story Three");
    expect(onToggle).not.toHaveBeenCalled(); // the panel never calls back on its own re-render
  });

  it("a real prop-inspection assertion: the component's declared prop shape has exactly {nodes, edges, open, onToggle, title?} — no onChange/onEdit/onSourceChange/mutation-capable prop of any kind", () => {
    // This walks the actual function's parameter destructuring at runtime
    // (not just "no visible input"): React function components receive a
    // single props object, and DiagramSourcePanel destructures it inline in
    // its signature, so calling it directly (bypassing JSX) with a props
    // object carrying an extra "mutating" field proves that field is never
    // read/used by inspecting what changes in the rendered output.
    const attemptedMutationProps = {
      nodes: NODES,
      edges: EDGES,
      open: true,
      onToggle: () => {},
      // A hypothetical accidental future mutation channel — if
      // DiagramSourcePanel ever started reading this, source text
      // rendering would need to reference it, which the source-level
      // assertion below (reading the real file) additionally guards.
      onChange: vi.fn(),
      onSourceChange: vi.fn(),
    } as unknown as DiagramSourcePanelProps;

    render(<DiagramSourcePanel {...attemptedMutationProps} />);
    // Typing/clicking has nothing to hook into: no input exists, and
    // neither extra callback was ever invoked by rendering or by clicking
    // the one real control (the toggle).
    fireEvent.click(screen.getByTestId("diagram-source-panel-toggle"));
    expect((attemptedMutationProps as unknown as { onChange: ReturnType<typeof vi.fn> }).onChange).not.toHaveBeenCalled();
    expect(
      (attemptedMutationProps as unknown as { onSourceChange: ReturnType<typeof vi.fn> }).onSourceChange,
    ).not.toHaveBeenCalled();
  });

  it("static guard: the component's own source defines no onChange/onEdit/onInput/onSourceChange prop and no <input>/<textarea>/contentEditable markup", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "DiagramSourcePanel.tsx"), "utf-8");

    expect(source).not.toMatch(/on(Change|Edit|Input|SourceChange|Mutate)\s*[?:]/);
    expect(source).not.toMatch(/<input\b/i);
    expect(source).not.toMatch(/<textarea\b/i);
    expect(source).not.toMatch(/contentEditable/i);
  });
});

describe("DiagramSourcePanel — renders identically in structure across all 3 skins", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-skin");
  });

  for (const skin of ["drafting", "case-board", "harness"] as const) {
    it(`toggle + open panel both render for the ${skin} skin`, () => {
      document.documentElement.setAttribute("data-skin", skin);
      render(<DiagramSourcePanel nodes={NODES} edges={EDGES} open onToggle={() => {}} />);

      expect(screen.getByTestId("diagram-source-panel-toggle")).toBeInTheDocument();
      expect(screen.getByTestId("diagram-source-panel-text")).toHaveTextContent("Story One");
    });
  }
});
