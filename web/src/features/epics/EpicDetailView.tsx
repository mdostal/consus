import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { DiagramView } from "../../components/DiagramView";
import { fetchEpicDetail, type EpicDetail } from "../../api/epics";
import { DecisionActions } from "./DecisionActions";
import { EpicDocsPanel } from "./EpicDocsPanel";
import { StoriesTable } from "./StoriesTable";
import { tokens } from "../../theme/tokens";
import "../../theme/tokens.css";

type TabKey = "diagrams" | "docs" | "stories" | "decisions";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; epic: EpicDetail };

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "diagrams", label: "Diagrams" },
  { key: "docs", label: "Docs" },
  { key: "stories", label: "Stories" },
  { key: "decisions", label: "Decisions" },
];

const styles = {
  shell: { display: "grid", gap: 18 },
  header: {
    alignItems: "start",
    borderBottom: `1px solid ${tokens.color.line}`,
    display: "flex",
    gap: 16,
    justifyContent: "space-between",
    paddingBottom: 16,
  },
  title: { margin: 0 },
  meta: { color: tokens.color.inkMuted, margin: "6px 0 0" },
  tabs: {
    borderBottom: `1px solid ${tokens.color.line}`,
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
  },
  tab: {
    background: "transparent",
    border: 0,
    borderBottomColor: "transparent",
    borderBottomStyle: "solid",
    borderBottomWidth: 3,
    color: tokens.color.inkMuted,
    cursor: "pointer",
    fontWeight: 700,
    padding: "10px 12px",
  },
  activeTab: {
    borderBottomColor: tokens.color.accent,
    color: tokens.color.ink,
  },
  diagramGrid: {
    display: "grid",
    gap: 16,
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  },
  sectionTitle: { margin: "0 0 10px" },
  error: { color: tokens.color.bad },
} as const;

export function EpicDetailView() {
  const { epic_id } = useParams();
  const [activeTab, setActiveTab] = useState<TabKey>("diagrams");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (!epic_id) {
      setState({ status: "error", message: "Missing epic id." });
      return;
    }

    setState({ status: "loading" });
    fetchEpicDetail(epic_id)
      .then((epic) => {
        if (!cancelled) setState({ status: "ready", epic });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : "Failed to load epic." });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [epic_id]);

  if (state.status === "loading") {
    return <p data-testid="epic-detail-loading">Loading epic...</p>;
  }

  if (state.status === "error") {
    return (
      <p data-testid="epic-detail-error" role="alert" style={styles.error}>
        Couldn&apos;t load epic. {state.message}
      </p>
    );
  }

  const { epic } = state;
  const repoId = epic.repo_id ?? "consus";

  function updateStatus(status: string) {
    setState((current) => (current.status === "ready" ? { status: "ready", epic: { ...current.epic, status } } : current));
  }

  return (
    <article data-testid="epic-detail-view" style={styles.shell}>
      <header style={styles.header}>
        <div>
          <h2 style={styles.title}>{epic.title}</h2>
          <p style={styles.meta}>
            Status: <span data-testid="epic-detail-status">{epic.status}</span>
          </p>
        </div>
        <DecisionActions compact epicId={epic.id} onApproved={updateStatus} status={epic.status} />
      </header>

      <nav aria-label="Epic detail tabs" role="tablist" style={styles.tabs}>
        {TABS.map((tab) => (
          <button
            aria-selected={activeTab === tab.key}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            role="tab"
            style={{ ...styles.tab, ...(activeTab === tab.key ? styles.activeTab : {}) }}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "diagrams" ? (
        <section aria-label="Epic diagrams" data-testid="epic-diagrams-tab" style={styles.diagramGrid}>
          <DiagramView repo_id={repoId} type="cascade" />
          <DiagramView repo_id={repoId} type="repo-architecture" />
        </section>
      ) : null}

      {activeTab === "docs" ? <EpicDocsPanel docs={epic.docs} /> : null}

      {activeTab === "stories" ? <StoriesTable stories={epic.stories} /> : null}

      {activeTab === "decisions" ? (
        <section data-testid="epic-decisions-tab">
          <h3 style={styles.sectionTitle}>Decision Actions</h3>
          <DecisionActions epicId={epic.id} onApproved={updateStatus} status={epic.status} />
        </section>
      ) : null}
    </article>
  );
}
