import { describe, it, expect } from "vitest";
import {
  buildCascadeMermaid,
  buildClaudePrompt,
  diagramToStandaloneHtml,
  docToStandaloneHtml,
  normalizeImportedContent,
} from "./send-out.js";
import { buildMermaidSource } from "../../web/src/features/projects/DiagramView";

const EPICS = [
  {
    id: "epic-a",
    title: 'Epic "A"',
    stories: [
      { id: "s-1", title: "One", complexity: "low", dependsOn: [] },
      { id: "s-2", title: "Two", complexity: null, dependsOn: ["s-1"] },
    ],
  },
];

/** True when the document references nothing outside itself: no scripts,
 *  no external stylesheets, images, frames or fonts. */
function externalReferences(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const refs: string[] = [];
  doc.querySelectorAll("script, link, iframe, object, embed").forEach((el) => refs.push(el.outerHTML));
  doc.querySelectorAll("[src]").forEach((el) => refs.push(el.getAttribute("src")!));
  if (/@import|url\(/i.test(doc.querySelector("style")?.textContent ?? "")) refs.push("css url()");
  return refs;
}

describe("buildCascadeMermaid", () => {
  it("matches the web source panel's buildMermaidSource exactly", () => {
    expect(buildCascadeMermaid(EPICS)).toBe(buildMermaidSource(EPICS));
  });
});

describe("docToStandaloneHtml", () => {
  const md = "# Title\n\nSome *text*.\n\n```mermaid\ngraph TD\n  a[\"API\"] --> b[\"DB\"]\n```\n\n```ts\nconst x = 1;\n```\n";

  it("renders markdown with mermaid blocks as inline SVG and is fully standalone", () => {
    const html = docToStandaloneHtml("docs/arch.md", "md", md, "doc:r:docs/arch.md");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(doc.title).toBe("docs/arch.md");
    expect(doc.querySelector("h1")?.textContent).toBe("Title");
    expect(doc.querySelector("em")?.textContent).toBe("text");
    const svg = doc.querySelector("figure.mermaid-diagram svg");
    expect(svg).not.toBeNull();
    expect(Array.from(svg!.querySelectorAll("g[data-node-id]"), (g) => g.textContent)).toEqual(["API", "DB"]);
    expect(doc.querySelector("pre.mermaid-source")?.textContent).toContain('a["API"] --> b["DB"]');
    expect(doc.querySelector("code.language-ts")?.textContent).toContain("const x = 1;");
    expect(doc.querySelector('meta[name="consus-item-id"]')?.getAttribute("content")).toBe("doc:r:docs/arch.md");
    expect(externalReferences(html)).toEqual([]);
  });

  it("keeps an unrenderable mermaid block as visible source", () => {
    const html = docToStandaloneHtml("x.md", "md", "```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n", "doc:r:x.md");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("figure.mermaid-diagram svg")).toBeNull();
    expect(doc.querySelector("pre.mermaid-source")?.textContent).toContain("sequenceDiagram");
  });

  it("ships a full-page .html doc as-is and wraps an HTML fragment", () => {
    const page = "<!doctype html><html><body><p>brand</p></body></html>";
    expect(docToStandaloneHtml("b.html", "html", page, "doc:r:b.html")).toBe(page);
    const wrapped = docToStandaloneHtml("f.html", "html", "<p>fragment</p>", "doc:r:f.html");
    expect(wrapped).toContain("<!doctype html>");
    expect(wrapped).toContain("<p>fragment</p>");
  });
});

describe("diagramToStandaloneHtml", () => {
  it("embeds the diagram as SVG with its source and no external references", () => {
    const html = diagramToStandaloneHtml("repo cascade", buildCascadeMermaid(EPICS), "diagram:repo");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("figure svg g[data-node-id]")).toHaveLength(2);
    expect(externalReferences(html)).toEqual([]);
  });
});

describe("buildClaudePrompt", () => {
  it("carries the item id, the content, and the record/import calls", () => {
    const prompt = buildClaudePrompt({
      itemId: "doc:repo:docs/a b.md",
      title: "docs/a b.md",
      contentFormat: "md",
      content: "# Hi\n\n```ts\nx\n```",
      consusUrl: "http://127.0.0.1:8722",
    });
    expect(prompt).toContain("item id: doc:repo:docs/a b.md");
    expect(prompt).toContain("interactive Claude artifact");
    expect(prompt).toContain("PUT http://127.0.0.1:8722/api/items/doc%3Arepo%3Adocs%2Fa%20b.md/claude-artifact");
    expect(prompt).toContain("POST http://127.0.0.1:8722/api/items/doc%3Arepo%3Adocs%2Fa%20b.md/import");
    expect(prompt).toContain("proposal");
    // The outer fence is longer than the doc's own ``` so it can't close early.
    expect(prompt).toContain("````markdown\n# Hi\n\n```ts\nx\n```\n````");
  });

  it("passes the diagram kind back for diagram imports", () => {
    const prompt = buildClaudePrompt({
      itemId: "diagram:repo",
      title: "t",
      contentFormat: "mmd",
      content: "graph TD",
      consusUrl: "http://h",
      diagramKind: "architecture",
    });
    expect(prompt).toContain('"kind":"architecture"');
    expect(prompt).toContain("```mermaid\ngraph TD\n```");
  });
});

describe("normalizeImportedContent", () => {
  it("strips CRLF, a whole-document markdown fence, and matches the original's trailing newline", () => {
    expect(normalizeImportedContent("```markdown\r\n# A\r\nb\r\n```\r\n", "# A\n", "doc")).toBe("# A\nb\n");
    expect(normalizeImportedContent("x\n\n", "y", "doc")).toBe("x");
  });

  it("pulls the mermaid source out of a diagram exported as markdown", () => {
    expect(normalizeImportedContent("# T\n\n```mermaid\ngraph TD\n  a --> b\n```\n", "graph TD\n", "diagram")).toBe(
      "graph TD\n  a --> b\n",
    );
  });

  it("leaves a doc's inner code fences alone", () => {
    const md = "# A\n\n```ts\nx\n```\n\ntext\n";
    expect(normalizeImportedContent(md, md, "doc")).toBe(md);
  });
});
