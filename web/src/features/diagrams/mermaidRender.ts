/**
 * PANT-965: the one place Consus calls the mermaid library. It is loaded on
 * first use (dynamic import) so the main bundle doesn't carry it, and every
 * caller gets a plain result object back — a syntax error comes back as
 * `{ ok: false, error }` for the UI to show, never as a thrown exception or
 * an empty render.
 *
 * Tests mock this module: mermaid needs real SVG layout (getBBox), which
 * jsdom doesn't implement. The real library is exercised by the Playwright
 * check in e2e/.
 */

export type MermaidRenderResult = { ok: true; svg: string } | { ok: false; error: string };

type MermaidApi = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderCounter = 0;

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      // "strict" sanitizes labels and disables click handlers in diagram
      // source — repo content is untrusted input here.
      securityLevel: "strict",
      // Without this, mermaid injects its own "Syntax error" bomb graphic
      // into document.body on a parse failure.
      suppressErrorRendering: true,
      theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default",
    });
    return mermaid;
  });
  return mermaidPromise;
}

export async function renderMermaid(source: string): Promise<MermaidRenderResult> {
  if (!source.trim()) {
    return { ok: false, error: "The diagram is empty." };
  }
  try {
    const mermaid = await loadMermaid();
    renderCounter += 1;
    const { svg } = await mermaid.render(`consus-mermaid-${renderCounter}`, source);
    return { ok: true, svg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message || "Mermaid could not render this diagram." };
  }
}
