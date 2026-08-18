import { useEffect, useMemo, useRef, useState } from "react";
import { AuditPanel, type AuditTrailEntry } from "../audit/AuditPanel";
import { getMermaidThemeVariables } from "../../theme/mermaidTheme";

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

/** What a rendered node's sanitized id resolves back to (p9-02). */
export type DiagramNodeEntry = { kind: "story"; story: DiagramStory } | { kind: "epic"; epic: DiagramEpic };

/**
 * Pure: reverse-lookup from a sanitized node id (as produced by
 * sanitizeMermaidId, same ids buildMermaidSource embeds in the graph source)
 * back to the originating story or epic. Built alongside the graph source
 * so a click on a rendered node can be mapped to real data without parsing
 * label text (p9-02).
 */
export function buildNodeLookup(epics: DiagramEpic[]): Map<string, DiagramNodeEntry> {
  const lookup = new Map<string, DiagramNodeEntry>();

  for (const epic of epics) {
    lookup.set(sanitizeMermaidId(`epic_${epic.id}`), { kind: "epic", epic });
    for (const story of epic.stories) {
      lookup.set(sanitizeMermaidId(`story_${story.id}`), { kind: "story", story });
    }
  }

  return lookup;
}

/**
 * Mermaid's rendered node ids contain the sanitized id passed into render()
 * rather than equal it exactly (e.g. wrapped as `flowchart-n_story_s1-0`),
 * so this looks for a lookup key present in elementId at a token boundary —
 * guards against a false match like `n_story_s1` inside `n_story_s10`.
 */
function findNodeKey(elementId: string, keys: Iterable<string>): string | null {
  for (const key of keys) {
    const boundary = new RegExp(`(?:^|[^a-zA-Z0-9_])${key}(?:$|[^a-zA-Z0-9_])`);
    if (boundary.test(elementId)) return key;
  }
  return null;
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
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);

  const nodeLookup = useMemo(() => buildNodeLookup(epics), [epics]);
  const storyTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const epic of epics) {
      for (const story of epic.stories) {
        map.set(story.id, story.title);
      }
    }
    return map;
  }, [epics]);

  const selectedEntry = selectedNodeKey ? (nodeLookup.get(selectedNodeKey) ?? null) : null;
  const selectedStory = selectedEntry?.kind === "story" ? selectedEntry.story : null;

  useEffect(() => {
    setSelectedNodeKey(null);
    if (epics.length === 0) return;

    let cancelled = false;
    setRendering(true);
    setRenderError(null);

    const renderDiagram = async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const { default: mermaid } = await import("mermaid");
        // s1 (consus-phase18): "base" + real themeVariables sourced from the
        // active --consus-* tokens, so the rendered graph itself follows the
        // active skin/theme instead of always using Mermaid's fixed default
        // light palette (styling only — the graph source/shape is unchanged).
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: getMermaidThemeVariables(),
        });

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

          // p9-02: wire clicks on the rendered node elements directly (no Mermaid
          // `click` directive/global callback — see buildNodeLookup/findNodeKey above).
          const nodeEls = container.querySelectorAll<SVGElement>(".node");
          nodeEls.forEach((nodeEl) => {
            const key = findNodeKey(nodeEl.id, nodeLookup.keys());
            const entry = key ? nodeLookup.get(key) : undefined;
            if (!key || !entry || entry.kind !== "story") return;

            nodeEl.style.cursor = "pointer";
            nodeEl.addEventListener("click", () => {
              setSelectedNodeKey((prev) => (prev === key ? null : key));
            });
          });
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
        <div className="diagram-view__body">
          <div
            ref={graphRef}
            className="diagram-view__graph"
            role="img"
            aria-busy={rendering}
            aria-label={`${repo} epic/story diagram`}
            data-testid="diagram-view-graph"
          />

          {selectedStory ? (
            <div className="diagram-view__detail" data-testid="diagram-view-detail">
              <div className="diagram-view__detail-header">
                <h4>{selectedStory.title}</h4>
                <button type="button" onClick={() => setSelectedNodeKey(null)} aria-label="Close detail panel">
                  ×
                </button>
              </div>
              <dl>
                <dt>ID</dt>
                <dd>{selectedStory.id}</dd>
                <dt>Complexity</dt>
                <dd>{selectedStory.complexity ?? "—"}</dd>
                <dt>Depends on</dt>
                <dd>
                  {selectedStory.dependsOn.length === 0
                    ? "—"
                    : selectedStory.dependsOn.map((depId) => storyTitleById.get(depId) ?? depId).join(", ")}
                </dd>
              </dl>
            </div>
          ) : null}
        </div>
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
