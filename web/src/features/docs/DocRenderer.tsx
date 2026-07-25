import { useMemo } from "react";
import { marked } from "marked";
import "../../theme/tokens.css";

export interface DocRendererProps {
  format: "md" | "html";
  content: string;
}

/**
 * REQ-03: renders a doc as formatted content — never raw markup. Uses the
 * shared DecisionCard theme tokens (scoped-scroll container, per REQ-15)
 * for wide tables/diagrams inside rendered docs.
 */
export function DocRenderer({ format, content }: DocRendererProps) {
  const html = useMemo(() => (format === "md" ? (marked.parse(content, { async: false }) as string) : content), [
    format,
    content,
  ]);

  return (
    <div data-testid="doc-html" className="doc-renderer" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
