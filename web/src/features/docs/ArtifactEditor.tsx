import { useState, useEffect } from "react";
import { fetchKbDrafts, fetchKbVersions, saveKbDraft, submitKbEntry } from "../../api/kb";
import { DocRenderer } from "./DocRenderer";
import { SectionDiff } from "./SectionDiff";
import { splitIntoSections } from "../../utils/sections";
import "../../theme/tokens.css";

export interface ArtifactEditorProps {
  id: string;
  initialContent: string;
}

/**
 * REQ: consus-editable-artifact-doc
 * Renders an artifact doc broken down into editable sections.
 * Allows preserving durable drafts that survive reload, and submitting finalized docs.
 * Sections where the human draft diverges from the agent-published version are
 * shown in a diff view (REQ: consus-editable-artifact-doc/sectional-diff-view)
 * instead of the normal view, until the human explicitly accepts the agent's
 * version or sends it back (which leaves their draft untouched).
 */
export function ArtifactEditor({ id, initialContent }: ArtifactEditorProps) {
  const [sections, setSections] = useState<string[]>([]);
  // Snapshot of the human/agent sections exactly as loaded, used only to
  // detect which sections need review — kept separate from `sections` (the
  // live, editable copy) so typing in an unrelated edit doesn't spuriously
  // trigger a diff prompt.
  const [loadedHumanSections, setLoadedHumanSections] = useState<string[]>([]);
  const [agentSections, setAgentSections] = useState<string[]>([]);
  const [resolvedDiffs, setResolvedDiffs] = useState<Record<number, boolean>>({});
  const [isEditing, setIsEditing] = useState<Record<number, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setResolvedDiffs({});
      try {
        const [drafts, versions] = await Promise.all([fetchKbDrafts(id), fetchKbVersions(id)]);
        const lastDraft = drafts[drafts.length - 1];
        const publishedVersions = versions.filter((v) => v.state === "published");
        const lastPublished = publishedVersions[publishedVersions.length - 1];
        const humanContent = lastDraft ? lastDraft.content : initialContent;
        const agentContent = lastPublished ? lastPublished.content : initialContent;
        const humanSections = splitIntoSections(humanContent);
        setSections(humanSections);
        setLoadedHumanSections(humanSections);
        setAgentSections(splitIntoSections(agentContent));
      } catch (err) {
        console.error("Failed to load drafts", err);
        const fallbackSections = splitIntoSections(initialContent);
        setSections(fallbackSections);
        setLoadedHumanSections(fallbackSections);
        setAgentSections(fallbackSections);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [id, initialContent]);

  const handleSaveDraft = async () => {
    const fullContent = sections.join("");
    // Hardcoded author "user" for now, as there isn't an auth context in this snippet
    await saveKbDraft(id, "user", fullContent);
  };

  const handleSubmit = async () => {
    const fullContent = sections.join("");
    await submitKbEntry(id, "user", fullContent);
  };

  const updateSection = (idx: number, newContent: string) => {
    const newSections = [...sections];
    newSections[idx] = newContent;
    setSections(newSections);
  };

  const acceptAgentSection = (idx: number) => {
    updateSection(idx, agentSections[idx]);
    setResolvedDiffs({ ...resolvedDiffs, [idx]: true });
  };

  const sendBackSection = (idx: number) => {
    setResolvedDiffs({ ...resolvedDiffs, [idx]: true });
  };

  if (isLoading) {
    return <div>Loading document...</div>;
  }

  return (
    <div className="artifact-editor">
      <div className="artifact-editor-controls" style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}>
        <button onClick={handleSaveDraft}>Save</button>
        <button onClick={handleSubmit}>Submit</button>
      </div>
      <div className="artifact-editor-sections">
        {sections.map((section, idx) => {
          const agentSection = agentSections[idx];
          const loadedHumanSection = loadedHumanSections[idx];
          const hasUnresolvedDiff =
            agentSection !== undefined && loadedHumanSection !== agentSection && !resolvedDiffs[idx];

          return (
            <div key={idx} className="artifact-section" style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem", position: "relative" }}>
              {hasUnresolvedDiff ? (
                <SectionDiff
                  humanText={loadedHumanSection}
                  agentText={agentSection}
                  onAccept={() => acceptAgentSection(idx)}
                  onSendBack={() => sendBackSection(idx)}
                />
              ) : isEditing[idx] ? (
                <div className="artifact-section-edit">
                  <textarea
                    value={section}
                    onChange={(e) => updateSection(idx, e.target.value)}
                    style={{ width: "100%", fontFamily: "monospace", minHeight: "100px" }}
                    rows={section.split("\n").length + 2}
                  />
                  <div style={{ marginTop: "0.5rem", textAlign: "right" }}>
                    <button onClick={() => setIsEditing({ ...isEditing, [idx]: false })}>Done</button>
                  </div>
                </div>
              ) : (
                <div className="artifact-section-view">
                  <div style={{ position: "absolute", top: "0.5rem", right: "0.5rem" }}>
                    <button onClick={() => setIsEditing({ ...isEditing, [idx]: true })}>Edit Section</button>
                  </div>
                  <DocRenderer format="md" content={section} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
