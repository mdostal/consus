import { describe, it, expect } from "vitest";
import { extractMermaidBlocks, isMermaidLang, replaceMermaidBlock } from "./mermaidBlocks";

const DOC = [
  "# Architecture",
  "",
  "```mermaid",
  "flowchart LR",
  "  a --> b",
  "```",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "~~~mermaid",
  "sequenceDiagram",
  "  A->>B: hi",
  "~~~",
  "",
].join("\n");

describe("mermaid blocks in markdown", () => {
  it("finds mermaid fences in document order and ignores other languages", () => {
    const blocks = extractMermaidBlocks(DOC);
    expect(blocks.map((b) => b.source)).toEqual(["flowchart LR\n  a --> b", "sequenceDiagram\n  A->>B: hi"]);
    expect(blocks.every((b) => b.editable)).toBe(true);
  });

  it("recognises the mermaid language tag case-insensitively, with trailing info", () => {
    expect(isMermaidLang("mermaid")).toBe(true);
    expect(isMermaidLang("Mermaid title=x")).toBe(true);
    expect(isMermaidLang("ts")).toBe(false);
    expect(isMermaidLang(undefined)).toBe(false);
  });

  it("replaces only the chosen block's source, leaving fences and the rest of the doc as written", () => {
    const next = replaceMermaidBlock(DOC, 1, "sequenceDiagram\n  A->>B: hello\n  B-->>A: hi back");
    expect(next).toBe(DOC.replace("  A->>B: hi\n", "  A->>B: hello\n  B-->>A: hi back\n"));
    expect(extractMermaidBlocks(next!)[0].source).toBe("flowchart LR\n  a --> b");
  });

  it("finds the right occurrence when two blocks have identical source", () => {
    const doc = "```mermaid\nflowchart LR\n```\n\ntext\n\n```mermaid\nflowchart LR\n```\n";
    expect(replaceMermaidBlock(doc, 1, "flowchart TD")).toBe(
      "```mermaid\nflowchart LR\n```\n\ntext\n\n```mermaid\nflowchart TD\n```\n",
    );
  });

  it("can fill an empty block", () => {
    expect(replaceMermaidBlock("```mermaid\n```\n", 0, "flowchart LR")).toBe("```mermaid\nflowchart LR\n```\n");
  });

  it("returns null for an index with no block", () => {
    expect(replaceMermaidBlock(DOC, 5, "x")).toBeNull();
  });
});
