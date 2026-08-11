import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import { tokens } from "../theme/tokens";
import "../theme/tokens.css";

export type DiagramViewType = "repo-architecture" | "cascade";
export type DiagramViewLevel = "top" | "full";

export interface DiagramViewProps {
  type: DiagramViewType;
  repo_id?: string;
  level?: DiagramViewLevel;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      topLevel?: string;
      fullComponent?: string;
      cascade?: string;
      stale?: boolean;
    };

interface RepoDiagramResponse {
  topLevel?: string;
  fullComponent?: string;
  error?: string;
}

interface CascadeDiagramResponse {
  mermaid?: string;
  stale?: boolean;
  error?: string;
}

const styles = {
  shell: {
    border: `1px solid ${tokens.color.line}`,
    borderRadius: 8,
    background: tokens.color.bgSubtle,
    color: tokens.color.ink,
    overflow: "hidden",
  },
  toolbar: {
    alignItems: "center",
    borderBottom: `1px solid ${tokens.color.line}`,
    display: "flex",
    gap: 8,
    justifyContent: "space-between",
    padding: "10px 12px",
  },
  title: {
    color: tokens.color.inkMuted,
    fontSize: 13,
    fontWeight: 700,
    margin: 0,
  },
  toggleGroup: {
    display: "inline-flex",
    gap: 4,
  },
  toggleButton: {
    border: `1px solid ${tokens.color.line}`,
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    minWidth: 64,
    padding: "6px 10px",
  },
  diagram: {
    background: tokens.color.bg,
    minHeight: 320,
    overflow: "auto",
    padding: 16,
  },
  message: {
    margin: 0,
    padding: 16,
  },
  skeleton: {
    minHeight: 320,
    padding: 16,
  },
  skeletonLine: {
    background: `linear-gradient(90deg, ${tokens.color.line}, ${tokens.color.bgSubtle}, ${tokens.color.line})`,
    borderRadius: 6,
    height: 18,
    marginBottom: 14,
  },
} as const;

let renderCounter = 0;

function nextRenderId(): string {
  renderCounter += 1;
  return `consus-diagram-${renderCounter}`;
}

async function fetchDiagram({ type, repo_id }: DiagramViewProps): Promise<LoadState> {
  const endpoint =
    type === "cascade"
      ? "/api/diagrams/cascade"
      : repo_id
        ? `/api/diagrams/${encodeURIComponent(repo_id)}`
        : undefined;

  if (!endpoint) {
    return { status: "error", message: "repo_id is required for repo architecture diagrams." };
  }

  const response = await fetch(endpoint);
  const body = (await response.json()) as RepoDiagramResponse | CascadeDiagramResponse;
  if (!response.ok) {
    return { status: "error", message: body.error ?? `Diagram request failed with ${response.status}.` };
  }

  if (type === "cascade") {
    const cascade = (body as CascadeDiagramResponse).mermaid;
    if (!cascade) return { status: "error", message: "Diagram response did not include Mermaid source." };
    return { status: "ready", cascade, stale: (body as CascadeDiagramResponse).stale };
  }

  const repoBody = body as RepoDiagramResponse;
  if (!repoBody.topLevel || !repoBody.fullComponent) {
    return { status: "error", message: "Diagram response did not include architecture diagrams." };
  }
  return { status: "ready", topLevel: repoBody.topLevel, fullComponent: repoBody.fullComponent };
}

function MermaidDiagram({ source, label }: { source: string; label: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderState, setRenderState] = useState<"rendering" | "ready" | "error">("rendering");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    setRenderState("rendering");

    const computedStyle = window.getComputedStyle(document.documentElement);
    const getVar = (name: string) => computedStyle.getPropertyValue(name).trim() || '#ffffff';

    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        background: getVar('--consus-bg'),
        primaryColor: getVar('--consus-bg-subtle'),
        primaryTextColor: getVar('--consus-ink'),
        primaryBorderColor: getVar('--consus-line'),
        lineColor: getVar('--consus-accent'),
        secondaryColor: getVar('--consus-bg'),
        tertiaryColor: getVar('--consus-bg-subtle'),
      },
    });

    mermaid
      .render(nextRenderId(), source)
      .then(({ svg, bindFunctions }) => {
        if (cancelled || !container) return;
        container.innerHTML = svg;
        bindFunctions?.(container);
        setRenderState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        if (container) container.textContent = source;
        setRenderState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div
      aria-busy={renderState === "rendering"}
      aria-label={label}
      data-testid="diagram-mermaid"
      ref={containerRef}
      role="img"
      style={styles.diagram}
    />
  );
}

export function DiagramView({ type, repo_id, level = "top" }: DiagramViewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedLevel, setSelectedLevel] = useState<DiagramViewLevel>(level);

  useEffect(() => {
    setSelectedLevel(level);
  }, [level]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchDiagram({ type, repo_id, level })
      .then((nextState) => {
        if (!cancelled) setState(nextState);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : "Failed to load diagram." });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [type, repo_id, level]);

  const selectedSource = useMemo(() => {
    if (state.status !== "ready") return undefined;
    if (type === "cascade") return state.cascade;
    return selectedLevel === "top" ? state.topLevel : state.fullComponent;
  }, [state, type, selectedLevel]);

  const title = type === "cascade" ? "Cascade org tree" : `${repo_id ?? "Repository"} architecture`;
  const diagramLabel = type === "cascade" ? "Cascade org tree diagram" : `${selectedLevel} architecture diagram`;

  return (
    <section aria-label={title} data-testid="diagram-view" style={styles.shell}>
      <header style={styles.toolbar}>
        <p style={styles.title}>
          {title}
          {state.status === "ready" && state.stale ? " (stale cache)" : ""}
        </p>
        {type === "repo-architecture" && state.status === "ready" ? (
          <div aria-label="Diagram level" role="group" style={styles.toggleGroup}>
            <button
              aria-pressed={selectedLevel === "top"}
              onClick={() => setSelectedLevel("top")}
              style={{
                ...styles.toggleButton,
                background: selectedLevel === "top" ? tokens.color.accent : tokens.color.bg,
                color: selectedLevel === "top" ? tokens.color.bg : tokens.color.ink,
              }}
              type="button"
            >
              Top
            </button>
            <button
              aria-pressed={selectedLevel === "full"}
              onClick={() => setSelectedLevel("full")}
              style={{
                ...styles.toggleButton,
                background: selectedLevel === "full" ? tokens.color.accent : tokens.color.bg,
                color: selectedLevel === "full" ? tokens.color.bg : tokens.color.ink,
              }}
              type="button"
            >
              Full
            </button>
          </div>
        ) : null}
      </header>

      {state.status === "loading" ? (
        <div aria-label="Loading diagram" data-testid="diagram-skeleton" style={styles.skeleton}>
          <div style={{ ...styles.skeletonLine, width: "64%" }} />
          <div style={{ ...styles.skeletonLine, width: "82%" }} />
          <div style={{ ...styles.skeletonLine, width: "48%" }} />
        </div>
      ) : null}

      {state.status === "error" ? (
        <p data-testid="diagram-error" role="alert" style={{ ...styles.message, color: tokens.color.bad }}>
          Couldn&apos;t load diagram. {state.message}
        </p>
      ) : null}

      {state.status === "ready" && selectedSource ? <MermaidDiagram label={diagramLabel} source={selectedSource} /> : null}
    </section>
  );
}
