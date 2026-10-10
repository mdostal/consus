import { useEffect, useState } from "react";
import { MermaidDiagram } from "./MermaidDiagram";

export type NewDocKind = "doc" | "diagram";

export interface DocTemplate {
  id: string;
  label: string;
  kind: NewDocKind;
  extension: ".md" | ".mmd";
  content: string;
}

export interface NewDocCreated {
  repo: string;
  path: string;
  itemId: string;
  proposal: { id: string; status: string; failure_reason?: string | null };
}

export interface NewDocFormProps {
  repo: string;
  kind: NewDocKind;
  onCreated: (created: NewDocCreated) => void;
  onCancel: () => void;
}

const DEFAULT_PATHS: Record<NewDocKind, string> = {
  doc: "docs/new-doc.md",
  diagram: "docs/diagrams/new-diagram.mmd",
};

/** Appends the template's extension when the typed path has none of its own. */
export function withExtension(path: string, extension: string): string {
  const trimmed = path.trim();
  const lastSegment = trimmed.split("/").pop() ?? "";
  return lastSegment.includes(".") ? trimmed : `${trimmed}${extension}`;
}

/**
 * PANT-965: "New doc" / "New diagram" for one project. The operator picks a
 * repo-relative path and a template (GET /api/docs/templates), can edit the
 * starter content (a diagram gets a live preview), and submits. Submitting
 * POSTs /api/docs/new, which fires a new-file proposal — Consus never
 * creates the file itself.
 */
export function NewDocForm({ repo, kind, onCreated, onCancel }: NewDocFormProps) {
  const [templates, setTemplates] = useState<DocTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [path, setPath] = useState(DEFAULT_PATHS[kind]);
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/docs/templates")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { templates: DocTemplate[] }) => {
        const forKind = body.templates.filter((t) => t.kind === kind);
        setTemplates(forKind);
        if (forKind[0]) {
          setTemplateId(forKind[0].id);
          setContent(forKind[0].content);
        }
      })
      .catch((e) => setError(`Could not load templates: ${e.message}`));
  }, [kind]);

  const template = templates?.find((t) => t.id === templateId);

  function pickTemplate(id: string) {
    const next = templates?.find((t) => t.id === id);
    setTemplateId(id);
    if (next) setContent(next.content);
  }

  function submit() {
    if (!template) return;
    const finalPath = withExtension(path, template.extension);
    setSubmitting(true);
    setError(null);
    fetch("/api/docs/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo,
        path: finalPath,
        template: template.id,
        content,
        description: description.trim() || undefined,
        requestedBy: "Mathew",
      }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        onCreated(body as NewDocCreated);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  const heading = kind === "diagram" ? "New diagram" : "New doc";

  return (
    <form
      className="new-doc-form"
      data-testid="new-doc-form"
      aria-label={heading}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3 className="dv__section-title">{heading}</h3>
      <p className="new-doc-form__note">
        Creates a proposal for the harness to add this file to <strong>{repo}</strong>. Consus doesn't write the repo.
      </p>
      <label>
        File path
        <input type="text" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
      </label>
      <label>
        Template
        <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} disabled={!templates}>
          {(templates ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className={kind === "diagram" ? "mermaid-editor__split" : undefined}>
        <label className="mermaid-editor__source">
          Content
          <textarea
            aria-label="New file content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={kind !== "diagram"}
          />
        </label>
        {kind === "diagram" ? (
          <div className="mermaid-editor__preview" data-testid="new-doc-preview">
            <span className="mermaid-editor__pane-label">Preview</span>
            {templates ? <MermaidDiagram source={content} /> : null}
          </div>
        ) : null}
      </div>
      <label>
        Description
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={`Create ${template ? withExtension(path, template.extension) : path}`}
        />
      </label>
      {error ? (
        <p className="state state--err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="new-doc-form__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={!template || !path.trim() || submitting}>
          Propose new file
        </button>
      </div>
    </form>
  );
}
