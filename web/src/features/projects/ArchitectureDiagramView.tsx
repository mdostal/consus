import { useEffect, useRef, useState } from "react";

export interface ArchitectureDiagramViewProps {
  repo: string;
  topLevel: string;
  fullComponent: string;
}

type Tab = "topLevel" | "fullComponent";

/** Renders every id/label unique to a single mermaid.render() call, so re-renders never collide with a stale one still finishing. */
let renderIdCounter = 0;

const RENDER_TIMEOUT_MS = 5000;

/**
 * Renders one of { topLevel, fullComponent }'s Mermaid `graph TD` source
 * strings into the given container, racing mermaid.render() against a
 * timeout — mirrors the render-with-timeout pattern DiagramView.tsx already
 * uses for the cascade, deliberately duplicated (not shared/imported) per
 * this story's design decision, since DiagramView.tsx and its test file are
 * not touched by this story.
 */
async function renderMermaid(
  source: string,
  container: HTMLDivElement,
  onError: (message: string) => void,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Diagram rendering timed out")), RENDER_TIMEOUT_MS);
    });

    const { svg, bindFunctions } = await Promise.race([
      mermaid.render(`architecture-diagram-view-${renderIdCounter++}`, source),
      timeout,
    ]);

    container.innerHTML = svg;
    bindFunctions?.(container);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError(
      /timed out/i.test(message)
        ? "This diagram is too complex to render quickly."
        : "We couldn't render this diagram. Please try again.",
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * A small, standalone Mermaid renderer for a single named graph — used
 * twice below, once per tab, so each pane owns its own render/error/loading
 * lifecycle independently of the other.
 */
function MermaidGraph({ source, label, testId }: { source: string; label: string; testId: string }) {
  const graphRef = useRef<HTMLDivElement | null>(null);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setRenderError(null);

    const container = graphRef.current;
    if (!container) return;

    renderMermaid(source, container, (message) => {
      if (!cancelled) setRenderError(message);
    }).finally(() => {
      if (!cancelled) setRendering(false);
    });

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (renderError) {
    return <p className="state state--err">{renderError}</p>;
  }

  return (
    <div
      ref={graphRef}
      className="architecture-diagram-view__graph"
      role="img"
      aria-busy={rendering}
      aria-label={label}
      data-testid={testId}
    />
  );
}

/**
 * Renders a repo's real directory-structure diagram — both the shallow
 * `topLevel` view and the richer `fullComponent` view (which also folds in
 * design-discussion.md file-path mentions) — as tabbed Mermaid graphs.
 * Standalone from DiagramView.tsx: this response has no story/epic
 * identities to look up, click-to-detail, or propose changes against, so
 * this component owns only "render a graph TD string."
 */
export function ArchitectureDiagramView({ repo, topLevel, fullComponent }: ArchitectureDiagramViewProps) {
  const [tab, setTab] = useState<Tab>("topLevel");

  return (
    <div className="architecture-diagram-view">
      <div className="architecture-diagram-view__header">
        <h3>{repo} — architecture diagram</h3>
      </div>

      <div className="architecture-diagram-view__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "topLevel"}
          className={tab === "topLevel" ? "consus__nav-btn consus__nav-btn--active" : "consus__nav-btn"}
          onClick={() => setTab("topLevel")}
        >
          Top level
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "fullComponent"}
          className={tab === "fullComponent" ? "consus__nav-btn consus__nav-btn--active" : "consus__nav-btn"}
          onClick={() => setTab("fullComponent")}
        >
          Full component
        </button>
      </div>

      {tab === "topLevel" ? (
        <MermaidGraph
          key="topLevel"
          source={topLevel}
          label={`${repo} top-level architecture diagram`}
          testId="architecture-diagram-view-graph-top-level"
        />
      ) : (
        <MermaidGraph
          key="fullComponent"
          source={fullComponent}
          label={`${repo} full-component architecture diagram`}
          testId="architecture-diagram-view-graph-full-component"
        />
      )}
    </div>
  );
}
