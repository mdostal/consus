import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCascadeDiagram, fetchRepoDiagram, type CascadeDiagram, type RepoDiagram } from "../api/diagrams";
import "../theme/tokens.css";
import "./DiagramViewer.css";

type DiagramMode = "repo" | "cascade";
type RepoDiagramView = "topLevel" | "fullComponent";

export interface DiagramViewerProps {
  repo: string;
  initialMode?: DiagramMode;
  className?: string;
}

interface LoadState {
  loading: boolean;
  error: string | null;
}

const RENDER_TIMEOUT_MS = 5000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SkeletonLoader() {
  return (
    <div className="diagram-viewer__skeleton" role="status" aria-label="Loading diagram">
      <div className="diagram-viewer__skeleton-line" />
      <div className="diagram-viewer__skeleton-line" />
      <div className="diagram-viewer__skeleton-line" />
    </div>
  );
}

export function DiagramViewer({ repo, initialMode = "repo", className }: DiagramViewerProps) {
  const [mode, setMode] = useState<DiagramMode>(initialMode);
  const [repoView, setRepoView] = useState<RepoDiagramView>("topLevel");
  const [repoDiagram, setRepoDiagram] = useState<RepoDiagram | null>(null);
  const [cascadeDiagram, setCascadeDiagram] = useState<CascadeDiagram | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ loading: false, error: null });
  const [renderedSvg, setRenderedSvg] = useState<string>("");
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderId = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDiagram() {
      setLoadState({ loading: true, error: null });
      try {
        if (mode === "repo") {
          const diagram = await fetchRepoDiagram(repo);
          if (!cancelled) setRepoDiagram(diagram);
        } else {
          const diagram = await fetchCascadeDiagram();
          if (!cancelled) setCascadeDiagram(diagram);
        }
        if (!cancelled) setLoadState({ loading: false, error: null });
      } catch (error) {
        if (!cancelled) setLoadState({ loading: false, error: errorMessage(error) });
      }
    }

    loadDiagram();

    return () => {
      cancelled = true;
    };
  }, [mode, repo]);

  const source = useMemo(() => {
    if (mode === "cascade") return cascadeDiagram?.mermaid ?? "";
    if (!repoDiagram) return "";
    return repoView === "topLevel" ? repoDiagram.topLevel : repoDiagram.fullComponent;
  }, [cascadeDiagram, mode, repoDiagram, repoView]);

  useEffect(() => {
    if (!source) {
      setRenderedSvg("");
      setRenderError(null);
      setRendering(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function renderDiagram() {
      setRendering(true);
      setRenderError(null);
      setRenderedSvg("");

      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Diagram rendering timed out")), RENDER_TIMEOUT_MS);
        });
        const result = await Promise.race([
          mermaid.render(`consus-diagram-${renderId.current++}`, source),
          timeout,
        ]);

        if (!cancelled) setRenderedSvg(result.svg);
      } catch (error) {
        if (!cancelled) {
          const message = errorMessage(error);
          setRenderError(
            /timed out/i.test(message)
              ? "This diagram is too complex to render quickly."
              : "We couldn't render this diagram. Check the Mermaid syntax and try again.",
          );
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (!cancelled) setRendering(false);
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [source]);

  const classes = ["diagram-viewer", className].filter(Boolean).join(" ");
  const isBusy = loadState.loading || rendering;

  return (
    <section className={classes} aria-label="Diagram viewer">
      <div className="diagram-viewer__tabs" role="tablist" aria-label="Diagram type">
        <button
          className="diagram-viewer__tab"
          type="button"
          role="tab"
          aria-selected={mode === "repo"}
          onClick={() => setMode("repo")}
        >
          Repository
        </button>
        <button
          className="diagram-viewer__tab"
          type="button"
          role="tab"
          aria-selected={mode === "cascade"}
          onClick={() => setMode("cascade")}
        >
          Cascade
        </button>
      </div>

      {mode === "repo" ? (
        <div className="diagram-viewer__tabs" role="tablist" aria-label="Repository diagram view">
          <button
            className="diagram-viewer__tab"
            type="button"
            role="tab"
            aria-selected={repoView === "topLevel"}
            onClick={() => setRepoView("topLevel")}
          >
            Top-level
          </button>
          <button
            className="diagram-viewer__tab"
            type="button"
            role="tab"
            aria-selected={repoView === "fullComponent"}
            onClick={() => setRepoView("fullComponent")}
          >
            Full component
          </button>
        </div>
      ) : null}

      <div className="diagram-viewer__stage">
        {isBusy ? <SkeletonLoader /> : null}
        {!isBusy && loadState.error ? (
          <p className="diagram-viewer__message diagram-viewer__message--error" role="alert">
            {loadState.error}
          </p>
        ) : null}
        {!isBusy && renderError ? (
          <p className="diagram-viewer__message diagram-viewer__message--error" role="alert">
            {renderError}
          </p>
        ) : null}
        {!isBusy && !loadState.error && !renderError && renderedSvg ? (
          <div
            className="diagram-viewer__canvas"
            data-testid="diagram-canvas"
            dangerouslySetInnerHTML={{ __html: renderedSvg }}
          />
        ) : null}
      </div>
    </section>
  );
}
