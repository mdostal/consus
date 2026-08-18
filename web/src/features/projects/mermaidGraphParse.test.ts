import { describe, it, expect } from "vitest";
import { parseMermaidGraph } from "./mermaidGraphParse";

describe("parseMermaidGraph", () => {
  it("parses a root node plus top-level dirs, exactly diagram-generator.ts's buildTopLevelGraph shape", () => {
    const source = 'graph TD\n  root["consus"]\n  root --> src["src"]\n  root --> server["server"]';
    const graph = parseMermaidGraph(source);

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        { id: "root", label: "consus" },
        { id: "src", label: "src" },
        { id: "server", label: "server" },
      ]),
    );
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "root", target: "src" }),
        expect.objectContaining({ source: "root", target: "server" }),
      ]),
    );
  });

  it("parses a deeper component graph with plain (no inline label) edges too", () => {
    const source = [
      "graph TD",
      '  root["consus"]',
      '  src["src"]',
      "  root --> src",
      '  src_index["index.ts"]',
      "  src --> src_index",
    ].join("\n");

    const graph = parseMermaidGraph(source);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        { id: "root", label: "consus" },
        { id: "src", label: "src" },
        { id: "src_index", label: "index.ts" },
      ]),
    );
    expect(graph.edges.map((e) => `${e.source}->${e.target}`)).toEqual(
      expect.arrayContaining(["root->src", "src->src_index"]),
    );
  });

  it("gives every edge a unique id", () => {
    const source = 'graph TD\n  root["r"]\n  root --> a["A"]\n  root --> b["B"]';
    const graph = parseMermaidGraph(source);
    const ids = new Set(graph.edges.map((e) => e.id));
    expect(ids.size).toBe(graph.edges.length);
  });

  it("tolerates unrecognized lines without throwing", () => {
    expect(() => parseMermaidGraph("graph TD\n  %% a comment\n  garbage line here")).not.toThrow();
  });

  it("returns an empty graph for an empty source string", () => {
    expect(parseMermaidGraph("")).toEqual({ nodes: [], edges: [] });
  });

  it("returns an empty graph (not a throw) for a missing/non-string source, e.g. a still-loading API response", () => {
    expect(parseMermaidGraph(undefined as unknown as string)).toEqual({ nodes: [], edges: [] });
    expect(parseMermaidGraph(null as unknown as string)).toEqual({ nodes: [], edges: [] });
  });
});
