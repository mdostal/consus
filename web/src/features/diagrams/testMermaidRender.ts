import type { MermaidRenderResult } from "./mermaidRender";

/**
 * A stand-in for mermaidRender.renderMermaid in jsdom tests (mermaid itself
 * needs real SVG layout). Any source containing "INVALID" fails the way a
 * mermaid syntax error does; anything else "renders" to an <svg> whose
 * text is the source, so tests can assert which source the preview shows.
 */
export async function fakeRenderMermaid(source: string): Promise<MermaidRenderResult> {
  if (!source.trim()) return { ok: false, error: "The diagram is empty." };
  if (source.includes("INVALID")) {
    return { ok: false, error: "Parse error on line 1: INVALID" };
  }
  const escaped = source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { ok: true, svg: `<svg data-testid="mermaid-svg"><text>${escaped}</text></svg>` };
}
