import { describe, it, expect } from "vitest";
import { parseFlowchart, mermaidToSvg } from "./mermaid-svg.js";

function parseSvg(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
}

describe("parseFlowchart", () => {
  it("reads diagram-generator's architecture subset", () => {
    const chart = parseFlowchart('graph TD\n  root["consus"]\n  root --> server["server"]\n  root --> web');
    expect(chart).toEqual({
      direction: "TD",
      nodes: [
        { id: "root", label: "consus", group: null },
        { id: "server", label: "server", group: null },
        { id: "web", label: "web", group: null },
      ],
      edges: [
        { source: "root", target: "server", label: null },
        { source: "root", target: "web", label: null },
      ],
      groups: [],
    });
  });

  it("reads the cascade's subgraphs and escaped labels", () => {
    const chart = parseFlowchart(
      'graph LR\n  subgraph n_epic_a["Epic &quot;A&quot;"]\n    n_story_1["One (low)"]\n    n_story_2["Two"]\n  end\n  n_story_1 --> n_story_2',
    )!;
    expect(chart.direction).toBe("LR");
    expect(chart.groups).toEqual(['Epic "A"']);
    expect(chart.nodes.map((n) => [n.id, n.label, n.group])).toEqual([
      ["n_story_1", "One (low)", 0],
      ["n_story_2", "Two", 0],
    ]);
    expect(chart.edges).toEqual([{ source: "n_story_1", target: "n_story_2", label: null }]);
  });

  it("reads hand-written shapes, chains and edge labels", () => {
    const chart = parseFlowchart("flowchart TB\n  a(Start) -->|go| b{Choice} --> c[End];\n  %% a comment\n  c -.-> a")!;
    expect(chart.nodes.map((n) => n.label)).toEqual(["Start", "Choice", "End"]);
    expect(chart.edges).toEqual([
      { source: "a", target: "b", label: "go" },
      { source: "b", target: "c", label: null },
      { source: "c", target: "a", label: null },
    ]);
  });

  it("returns null for non-flowchart diagrams", () => {
    expect(parseFlowchart("sequenceDiagram\n  A->>B: hi")).toBeNull();
    expect(parseFlowchart("")).toBeNull();
  });
});

describe("mermaidToSvg", () => {
  it("produces well-formed, self-contained SVG with every node and edge", () => {
    const svg = mermaidToSvg('graph TD\n  root["repo"]\n  root --> a["alpha"]\n  root --> b["beta"]', "Arch")!;
    const doc = parseSvg(svg);
    expect(doc.documentElement.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    expect(doc.querySelector("title")?.textContent).toBe("Arch");
    expect(Array.from(doc.querySelectorAll("g[data-node-id]"), (g) => g.textContent)).toEqual(["repo", "alpha", "beta"]);
    expect(doc.querySelectorAll("line")).toHaveLength(2);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("escapes labels so markup in a label can't break or inject into the SVG", () => {
    const svg = mermaidToSvg('graph TD\n  a["<script>alert(1)</script> & co"]')!;
    const doc = parseSvg(svg);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("g[data-node-id] text")?.textContent).toContain("& co");
  });

  it("never overlaps sibling nodes on the same level", () => {
    const children = Array.from({ length: 8 }, (_, i) => `  root --> c${i}["a fairly long directory name ${i}"]`);
    const doc = parseSvg(mermaidToSvg(["graph TD", '  root["r"]', ...children].join("\n"))!);
    const boxes = Array.from(doc.querySelectorAll("g[data-node-id] rect"), (r) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")),
    })).filter((b) => b.y > 20);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].w);
  });

  it("returns null for a source it can't render", () => {
    expect(mermaidToSvg("pie\n  \"a\": 1")).toBeNull();
  });
});
