import { useEffect, useState } from "react";
import { renderMermaid, type MermaidRenderResult } from "./mermaidRender";

export interface MermaidDiagramProps {
  source: string;
}

/**
 * PANT-965: renders one Mermaid diagram. A syntax error shows mermaid's own
 * message (role="alert") above the source that failed, so a broken diagram
 * is visible as broken instead of rendering as an empty box.
 */
export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const [result, setResult] = useState<MermaidRenderResult | null>(null);

  useEffect(() => {
    let current = true;
    renderMermaid(source).then((next) => {
      if (current) setResult(next);
    });
    // A newer source supersedes an in-flight render — only the latest
    // result ever lands, so fast typing can't show a stale diagram.
    return () => {
      current = false;
    };
  }, [source]);

  if (!result) {
    return (
      <div className="mermaid-diagram mermaid-diagram--loading" data-testid="mermaid-loading">
        Rendering diagram…
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="mermaid-diagram mermaid-diagram--error" role="alert" data-testid="mermaid-error">
        <p className="mermaid-diagram__error-title">Mermaid syntax error</p>
        <pre className="mermaid-diagram__error-message">{result.error}</pre>
        <details>
          <summary>Diagram source</summary>
          <pre className="mermaid-diagram__source">
            <code>{source}</code>
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram"
      data-testid="mermaid-diagram"
      // Mermaid's output, rendered with securityLevel "strict" (sanitized
      // labels, no click handlers) — see mermaidRender.ts.
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}
