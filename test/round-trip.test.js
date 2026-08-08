import { describe, expect, it } from "vitest";
import { roundTrip, toHTML, toMarkdown } from "../lib/converter.js";

describe("markdown/html converter", () => {
  it("preserves heading structure when converting markdown to HTML", () => {
    const html = toHTML(["# Title", "", "## Subtitle", "", "Body copy."].join("\n"));

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<h2>Subtitle</h2>");
    expect(html).toContain("<p>Body copy.</p>");
  });

  it("round-trips headers, paragraphs, emphasis, links, and blockquotes", () => {
    const markdown = [
      "# Title",
      "",
      "Paragraph with **bold**, *italic*, and [a link](https://example.com).",
      "",
      "> Quoted **text**",
    ].join("\n");

    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("converts edited HTML back to markdown while preserving markdown structure", () => {
    const html = [
      "<h1>Edited Title</h1>",
      "<p>Paragraph with <strong>bold</strong>, <em>italic</em>, and <a href=\"https://example.com\">a link</a>.</p>",
      "<blockquote><p>Edited quote</p></blockquote>",
    ].join("\n");

    expect(toMarkdown(html)).toBe(
      [
        "# Edited Title",
        "",
        "Paragraph with **bold**, *italic*, and [a link](https://example.com).",
        "",
        "> Edited quote",
      ].join("\n"),
    );
  });

  it("preserves code block language hints during round-trip", () => {
    const markdown = ["```js", "const value = 42;", "```"].join("\n");
    const html = toHTML(markdown);

    expect(html).toContain('<code class="language-js">');
    expect(toMarkdown(html)).toBe(markdown);
  });

  it("preserves nested list indentation during round-trip", () => {
    const markdown = [
      "- Alpha",
      "  - Alpha child",
      "  - Second child with **bold** text",
      "- Beta",
      "  1. First ordered child",
      "  2. Second ordered child",
    ].join("\n");

    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("can preserve non-markdown HTML attributes in metadata comments when requested", () => {
    const html = '<h2 data-consus-id="node-1">Decision</h2>';

    expect(toMarkdown(html, { preserveAttributes: true })).toBe(
      '## Decision\n<!-- consus:attrs {"tag":"h2","attrs":{"data-consus-id":"node-1"}} -->',
    );
  });
});
