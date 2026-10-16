import { useEffect, useState } from "react";
import { MermaidDiagram } from "./MermaidDiagram";

export interface MermaidEditorSave {
  source: string;
  description: string;
}

export interface MermaidEditorProps {
  /** The diagram source as it is in the repo today. */
  initialSource: string;
  /** Called with the edited source and a description. The caller turns it
   *  into a proposal — the editor never writes anything itself. */
  onSave: (save: MermaidEditorSave) => void;
  onCancel: () => void;
  /** Delay before the preview re-renders after a keystroke. */
  previewDelayMs?: number;
  title?: string;
}

export const DEFAULT_PREVIEW_DELAY_MS = 250;

/**
 * PANT-965: split source/preview editor for a Mermaid diagram — a `.mmd`
 * file or one ```mermaid block inside a markdown doc. The preview
 * re-renders shortly after typing stops; a syntax error shows in the
 * preview pane (MermaidDiagram) while the source stays editable.
 *
 * "Save as proposal" is enabled once the source differs from
 * `initialSource` and a description is filled in, the same gate
 * DocRenderer's section editor uses for "Fire to harness".
 */
export function MermaidEditor({
  initialSource,
  onSave,
  onCancel,
  previewDelayMs = DEFAULT_PREVIEW_DELAY_MS,
  title = "Edit diagram",
}: MermaidEditorProps) {
  const [draft, setDraft] = useState(initialSource);
  const [previewSource, setPreviewSource] = useState(initialSource);
  const [description, setDescription] = useState("");

  useEffect(() => {
    setDraft(initialSource);
    setPreviewSource(initialSource);
    setDescription("");
  }, [initialSource]);

  useEffect(() => {
    if (draft === previewSource) return;
    const timer = setTimeout(() => setPreviewSource(draft), previewDelayMs);
    return () => clearTimeout(timer);
  }, [draft, previewSource, previewDelayMs]);

  const hasChanges = draft !== initialSource;
  const canSave = hasChanges && description.trim() !== "";

  return (
    <div className="mermaid-editor" data-testid="mermaid-editor">
      <h4 className="mermaid-editor__title">{title}</h4>
      <div className="mermaid-editor__split">
        <label className="mermaid-editor__source">
          <span className="mermaid-editor__pane-label">Source</span>
          <textarea
            data-testid="mermaid-editor-source"
            aria-label="Diagram source"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <div className="mermaid-editor__preview" data-testid="mermaid-editor-preview" aria-live="polite">
          <span className="mermaid-editor__pane-label">Preview</span>
          <MermaidDiagram source={previewSource} />
        </div>
      </div>
      <label className="mermaid-editor__description">
        Description
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. added the cache between API and database"
        />
      </label>
      <div className="mermaid-editor__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave({ source: draft, description: description.trim() })}
        >
          Save as proposal
        </button>
      </div>
    </div>
  );
}
