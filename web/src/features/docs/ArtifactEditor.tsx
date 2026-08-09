import { useState, useEffect } from "react";
import { fetchKbDrafts, saveKbDraft, submitKbEntry } from "../../api/kb";
import { DocRenderer } from "./DocRenderer";
import "../../theme/tokens.css";

export interface ArtifactEditorProps {
  id: string;
  initialContent: string;
}

/**
 * REQ: consus-editable-artifact-doc
 * Renders an artifact doc broken down into editable sections.
 * Allows preserving durable drafts that survive reload, and submitting finalized docs.
 */
export function ArtifactEditor({ id, initialContent }: ArtifactEditorProps) {
  const [sections, setSections] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState<Record<number, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const drafts = await fetchKbDrafts(id);
        const lastDraft = drafts[drafts.length - 1];
        const contentToParse = lastDraft ? lastDraft.content : initialContent;
        const parsedSections = contentToParse.split(/(?=^#{1,3} )/m).filter(s => s.trim().length > 0);
        setSections(parsedSections.length > 0 ? parsedSections : [contentToParse]);
      } catch (err) {
        console.error("Failed to load drafts", err);
        const parsedSections = initialContent.split(/(?=^#{1,3} )/m).filter(s => s.trim().length > 0);
        setSections(parsedSections.length > 0 ? parsedSections : [initialContent]);
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
        {sections.map((section, idx) => (
          <div key={idx} className="artifact-section" style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem", position: "relative" }}>
            {isEditing[idx] ? (
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
        ))}
      </div>
    </div>
  );
}
