import { useEffect, useRef, useState } from "react";
import { AuditPanel, type AuditTrailEntry } from "../audit/AuditPanel";

export interface DiagramStory {
  id: string;
  title: string;
  complexity: string | null;
  dependsOn: string[];
}

export interface DiagramEpic {
  id: string;
  title: string;
  stories: DiagramStory[];
}

export interface ProposeChangeInput {
  diff: string;
  description: string;
}

export interface DiagramViewProps {
  repo: string;
  epics: DiagramEpic[];
  /** Present when a proposal was fired and hasn't resolved yet. */
  pendingProposal?: boolean;
  onProposeChange: (input: ProposeChangeInput) => void;
  /** s5: history for this diagram's item (audit_log + proposals), via the
   *  shared AuditPanel. Omit to keep the panel hidden. */
  auditEntries?: AuditTrailEntry[];
}

/** Renders every id/label unique to a single mermaid.render() call, so re-renders never collide with a stale one still finishing. */
let renderIdCounter = 0;

const RENDER_TIMEOUT_MS = 5000;

function sanitizeMermaidId(id: string): string {
  return `n_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "&quot;");
}

/**
 * Pure: turns the epics/stories/dependsOn tree into Mermaid `graph LR`
 * source text — one subgraph per epic, one node per story, one edge per
 * dependsOn relationship (dependency -> dependent, matching the direction
 * the old "depends on" list text read in). Re-derived fresh against this
 * component's own DiagramEpic/DiagramStory types (p9-01) rather than reusing
 * the archived cascade-tree-builder.ts, which mixed in Multica-specific
 * issue classification that has no equivalent here.
 */
export function buildMermaidSource(epics: DiagramEpic[]): string {
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

/**
 * Read-only cascade tree (epic -> stories -> dependency edges) rendered as a
 * real Mermaid graph, plus a propose-a-change action that fires through
 * s3's dispatch mechanism — Consus never edits the diagram data directly.
 * mermaid is imported dynamically (only diagram views pay for it) and the
 * graph source is built client-side from the `epics` prop; see
 * buildMermaidSource above (p9-01 — this replaces the nested-<ul> rendering
 * that architecture.md's decision #3 had deferred).
 */
export function DiagramView({ repo, epics, pendingProposal, onProposeChange, auditEntries }: DiagramViewProps) {
  const [composing, setComposing] = useState(false);
  const [diff, setDiff] = useState("");
  const [description, setDescription] = useState("");
  const graphRef = useRef<HTMLDivElement | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (epics.length === 0) return;

    let cancelled = false;
    setRendering(true);
    setRenderError(null);

    const renderDiagram = async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

        const source = buildMermaidSource(epics);
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Diagram rendering timed out")), RENDER_TIMEOUT_MS);
        });

        const { svg, bindFunctions } = await Promise.race([
          mermaid.render(`diagram-view-${renderIdCounter++}`, source),
          timeout,
        ]);

        if (cancelled) return;
        const container = graphRef.current;
        if (container) {
          container.innerHTML = svg;
          bindFunctions?.(container);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setRenderError(
          /timed out/i.test(message)
            ? "This diagram is too complex to render quickly."
            : "We couldn't render this diagram. Please try again.",
        );
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (!cancelled) setRendering(false);
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [epics]);

  const submit = () => {
    if (!diff.trim() || !description.trim()) return;
    onProposeChange({ diff: diff.trim(), description: description.trim() });
    setDiff("");
    setDescription("");
    setComposing(false);
  };

  return (
    <div className="diagram-view">
      <div className="diagram-view__header">
        <h3>{repo} — epic/story diagram</h3>
        {pendingProposal ? <span className="pill pill--pending">change proposed…</span> : null}
        <button type="button" onClick={() => setComposing((c) => !c)}>
          {composing ? "Cancel" : "Propose a change"}
        </button>
      </div>

      {composing ? (
        <div className="diagram-view__propose-form">
          <label>
            Description
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. removed load balancers for direct traffic through..."
            />
          </label>
          <label>
            Diff
            <textarea value={diff} onChange={(e) => setDiff(e.target.value)} placeholder="+ added X&#10;- removed Y" />
          </label>
          <button type="button" onClick={submit} disabled={!diff.trim() || !description.trim()}>
            Fire to harness
          </button>
        </div>
      ) : null}

      {epics.length === 0 ? (
        <p className="state">No epics yet for {repo}.</p>
      ) : renderError ? (
        <p className="state state--err">{renderError}</p>
      ) : (
        <div
          ref={graphRef}
          className="diagram-view__graph"
          role="img"
          aria-busy={rendering}
          aria-label={`${repo} epic/story diagram`}
          data-testid="diagram-view-graph"
        />
      )}

      {auditEntries ? (
        <div className="diagram-view__history">
          <h4>History</h4>
          <AuditPanel entries={auditEntries} />
        </div>
      ) : null}
    </div>
  );
}
