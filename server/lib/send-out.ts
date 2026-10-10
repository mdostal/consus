import { Marked } from "marked";
import { escapeXml, mermaidToSvg } from "./mermaid-svg.js";
import type { DiagramEpic } from "../routes/diagrams.js";

/**
 * PANT-964 ("send out"): everything that turns a Consus doc or diagram into
 * a file the operator can take elsewhere — raw .md, self-contained HTML,
 * .mmd, SVG — plus the "Open in Claude" prompt and the import-back
 * normalization. Pure functions only; the routes in send-out.ts do the I/O.
 */

/* ------------------------------ diagrams ----------------------------- */

function sanitizeMermaidId(id: string): string {
  return `n_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "&quot;");
}

/** Server-side twin of web DiagramView.tsx's buildMermaidSource — the
 *  cascade diagram as Mermaid, byte-identical to what the UI's source
 *  panel shows, so an exported .mmd matches what the operator saw. */
export function buildCascadeMermaid(epics: DiagramEpic[]): string {
  const lines = ["graph LR"];
  for (const epic of epics) {
    lines.push(`  subgraph ${sanitizeMermaidId(`epic_${epic.id}`)}["${escapeMermaidLabel(epic.title)}"]`);
    for (const story of epic.stories) {
      const label = story.complexity ? `${story.title} (${story.complexity})` : story.title;
      lines.push(`    ${sanitizeMermaidId(`story_${story.id}`)}["${escapeMermaidLabel(label)}"]`);
    }
    lines.push("  end");
  }
  for (const epic of epics) {
    for (const story of epic.stories) {
      for (const dependsOnId of story.dependsOn) {
        lines.push(`  ${sanitizeMermaidId(`story_${dependsOnId}`)} --> ${sanitizeMermaidId(`story_${story.id}`)}`);
      }
    }
  }
  return lines.join("\n");
}

export function diagramToMarkdown(title: string, mermaid: string): string {
  return `# ${title}\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`;
}

/* -------------------------------- HTML ------------------------------- */

const STANDALONE_CSS = `
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.55;
         color: #18181b; background: #fff; max-width: 920px; margin: 2rem auto; padding: 0 1.25rem; }
  pre { background: #f4f4f5; padding: 0.75rem 1rem; overflow-x: auto; border-radius: 6px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
  table { border-collapse: collapse; } th, td { border: 1px solid #d4d4d8; padding: 0.35rem 0.6rem; }
  img, svg { max-width: 100%; height: auto; }
  figure.mermaid-diagram { margin: 1.25rem 0; overflow-x: auto; }
  footer.consus-export { margin-top: 3rem; color: #71717a; font-size: 0.85em; border-top: 1px solid #e4e4e7; padding-top: 0.75rem; }
`;

/** A fenced ```mermaid block as an inline SVG figure, keeping the source
 *  beside it. Unsupported diagram types show the source only. */
function mermaidFigure(source: string): string {
  const svg = mermaidToSvg(source);
  const sourceBlock = `<pre class="mermaid-source"><code>${escapeXml(source)}</code></pre>`;
  return svg
    ? `<figure class="mermaid-diagram">${svg}<details><summary>Mermaid source</summary>${sourceBlock}</details></figure>`
    : `<figure class="mermaid-diagram"><figcaption>Mermaid diagram (not rendered offline)</figcaption>${sourceBlock}</figure>`;
}

function markdownToHtmlBody(markdown: string): string {
  const marked = new Marked();
  marked.use({
    renderer: {
      code({ text, lang }) {
        return lang?.trim().toLowerCase() === "mermaid" ? mermaidFigure(text) : false;
      },
    },
  });
  return marked.parse(markdown, { async: false }) as string;
}

/** A complete HTML document: inline CSS, inline SVG, no scripts and no
 *  external URLs, so it renders the same opened straight from disk. The
 *  footer carries the Consus item id for the import-back round trip. */
export function wrapStandaloneHtml(title: string, bodyHtml: string, itemId: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="Consus">',
    `<meta name="consus-item-id" content="${escapeXml(itemId)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<style>${STANDALONE_CSS}</style>`,
    "</head>",
    "<body>",
    bodyHtml,
    `<footer class="consus-export">Exported from Consus · item <code>${escapeXml(itemId)}</code></footer>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export function docToStandaloneHtml(title: string, format: "md" | "html" | "mmd", content: string, itemId: string): string {
  // An .html doc that is already a full page (e.g. a brand doc) ships as-is.
  if (format === "html" && /<html[\s>]/i.test(content)) return content;
  // A standalone .mmd diagram file (PANT-965) is one diagram, not markdown.
  if (format === "mmd") return wrapStandaloneHtml(title, mermaidFigure(content), itemId);
  return wrapStandaloneHtml(title, format === "md" ? markdownToHtmlBody(content) : content, itemId);
}

export function diagramToStandaloneHtml(title: string, mermaid: string, itemId: string): string {
  return wrapStandaloneHtml(title, `<h1>${escapeXml(title)}</h1>\n${mermaidFigure(mermaid)}`, itemId);
}

/* ---------------------------- Open in Claude --------------------------- */

export interface ClaudePromptInput {
  itemId: string;
  title: string;
  /** What the content is: a markdown doc, an HTML doc, or a Mermaid diagram. */
  contentFormat: "md" | "html" | "mmd";
  content: string;
  /** Base URL of this Consus server, for the record-artifact/import calls. */
  consusUrl: string;
  /** Diagram kind to pass back on import; omitted for docs. */
  diagramKind?: string;
}

const FENCE_LANG: Record<ClaudePromptInput["contentFormat"], string> = { md: "markdown", html: "html", mmd: "mermaid" };

function fenceFor(content: string): string {
  // A fence longer than any backtick run inside the content, so the
  // embedded doc's own code blocks can't close it early.
  const longest = Math.max(2, ...Array.from(content.matchAll(/`+/g), (m) => m[0].length));
  return "`".repeat(longest + 1);
}

/**
 * The ready-to-paste prompt for the operator's own interactive Claude Code
 * session. Background board agents can't publish artifacts, so this is a
 * hand-off to a live session: publish, iterate, then send the final back
 * to Consus as a proposal (never a direct write to the repo).
 */
export function buildClaudePrompt(input: ClaudePromptInput): string {
  const { itemId, title, contentFormat, content, consusUrl, diagramKind } = input;
  const encodedId = encodeURIComponent(itemId);
  const fence = fenceFor(content);
  const importBody = JSON.stringify({
    content: "<final content>",
    filename: contentFormat === "mmd" ? "final.mmd" : `final.${contentFormat}`,
    description: "<one line: what changed>",
    requestedBy: "claude-session",
    ...(diagramKind ? { kind: diagramKind } : {}),
  });
  return [
    `I'm sending you "${title}" from Consus (item id: ${itemId}).`,
    "",
    "1. Publish it as an interactive Claude artifact so we can work on it together.",
    contentFormat === "mmd"
      ? "   It is a Mermaid diagram: render it as an interactive diagram artifact."
      : "   Render it as a readable document artifact (render any ```mermaid blocks as diagrams).",
    "2. Give me the artifact URL. Record it on the Consus item:",
    `   curl -X PUT ${consusUrl}/api/items/${encodedId}/claude-artifact -H 'content-type: application/json' -d '{"url":"<artifact url>","actor":"claude-session"}'`,
    "3. Iterate with me on the artifact until I say it's final.",
    `4. Send the final ${contentFormat === "mmd" ? "Mermaid source (.mmd)" : `document (.${contentFormat})`} back to Consus as a proposal against the original item:`,
    `   curl -X POST ${consusUrl}/api/items/${encodedId}/import -H 'content-type: application/json' -d '${importBody}'`,
    "   (Build the JSON with a tool such as jq so the content is escaped properly.) If you can't reach Consus,",
    "   give me the final file and I'll paste it into the item's \"Import back\" box instead.",
    "",
    "Don't edit the source repo directly: Consus changes go out as proposals.",
    "",
    `Current content (${contentFormat}):`,
    "",
    `${fence}${FENCE_LANG[contentFormat]}`,
    content,
    fence,
    "",
  ].join("\n");
}

/* ------------------------------ Import back ---------------------------- */

const MERMAID_FENCE_RE = /```mermaid[^\n]*\n([\s\S]*?)\n```/;
const WHOLE_FENCE_RE = /^\s*(`{3,})(?:markdown|md)?[^\n]*\n([\s\S]*?)\n\1\s*$/;

/**
 * Normalizes content coming back from outside (pasted or uploaded) so the
 * proposal diff shows the real edit rather than transport noise: CRLF line
 * endings, a whole-document ```markdown fence a chat client wrapped it in,
 * a diagram exported as .md, and a trailing newline that differs from the
 * original's.
 */
export function normalizeImportedContent(raw: string, original: string, targetType: string): string {
  let content = raw.replace(/\r\n?/g, "\n");
  if (targetType === "diagram") {
    const mermaid = MERMAID_FENCE_RE.exec(content);
    if (mermaid) content = mermaid[1];
  } else {
    const whole = WHOLE_FENCE_RE.exec(content);
    if (whole) content = whole[2];
  }
  const originalEndsWithNewline = original.endsWith("\n");
  content = content.replace(/\n+$/, "");
  return originalEndsWithNewline ? `${content}\n` : content;
}
