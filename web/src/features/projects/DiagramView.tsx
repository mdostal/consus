import { useState } from "react";

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
}

/**
 * Read-only cascade tree (epic -> stories -> dependency edges) plus a
 * propose-a-change action that fires through s3's dispatch mechanism —
 * Consus never edits the diagram data directly. Nested-list rendering by
 * design (see architecture.md: a graphical DAG/diagram engine is explicitly
 * deferred, not this story's scope).
 */
export function DiagramView({ repo, epics, pendingProposal, onProposeChange }: DiagramViewProps) {
  const [composing, setComposing] = useState(false);
  const [diff, setDiff] = useState("");
  const [description, setDescription] = useState("");

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
      ) : (
        <ul className="diagram-view__epics">
          {epics.map((epic) => (
            <li key={epic.id}>
              <strong>{epic.title}</strong>
              <ul className="diagram-view__stories">
                {epic.stories.map((story) => (
                  <li key={story.id}>
                    {story.title}
                    {story.complexity ? <span className="diagram-view__complexity"> ({story.complexity})</span> : null}
                    {story.dependsOn.length > 0 ? (
                      <span className="diagram-view__deps"> — depends on {story.dependsOn.join(", ")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
