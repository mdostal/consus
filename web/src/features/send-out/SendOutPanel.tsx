import { useCallback, useEffect, useState } from "react";

/** Mirrors server/routes/send-out.ts's DIAGRAM_KINDS. */
export type DiagramKind = "cascade" | "architecture" | "architecture-full";

export type SendOutTarget =
  | { type: "doc"; repo: string; path: string }
  | { type: "diagram"; repo: string; kinds: DiagramKind[] };

export interface SendOutPanelProps {
  target: SendOutTarget;
  /** Called after import-back creates a proposal, so the host can refresh
   *  its history panel. */
  onProposalCreated?: () => void;
}

const KIND_LABELS: Record<DiagramKind, string> = {
  cascade: "Epic/story cascade",
  architecture: "Architecture (top level)",
  "architecture-full": "Architecture (full component)",
};

/** Same item-id conventions as server/routes/docs.ts / diagrams.ts. */
export function sendOutItemId(target: SendOutTarget): string {
  return target.type === "doc" ? `doc:${target.repo}:${target.path}` : `diagram:${target.repo}`;
}

export function exportUrl(target: SendOutTarget, format: string, kind?: DiagramKind): string {
  const repo = encodeURIComponent(target.repo);
  return target.type === "doc"
    ? `/api/export/doc?repo=${repo}&path=${encodeURIComponent(target.path)}&format=${format}`
    : `/api/export/diagram?repo=${repo}&kind=${kind ?? target.kinds[0]}&format=${format}`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}

/**
 * PANT-964 "send out": per-doc / per-diagram export (.md, standalone HTML,
 * .mmd, SVG, copy-as-markdown), the "Open in Claude" hand-off (copies a
 * ready-to-paste prompt for the operator's interactive Claude Code session,
 * plus the item's published artifact URL shown as a link), and import-back
 * (paste or upload the final .md/.mmd to create a proposal against this
 * item). Collapsed by default so it never crowds the doc it sits on.
 */
export function SendOutPanel({ target, onProposalCreated }: SendOutPanelProps) {
  const itemId = sendOutItemId(target);
  const kinds = target.type === "diagram" ? target.kinds : [];
  const [kind, setKind] = useState<DiagramKind | undefined>(kinds[0]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Shown when the clipboard is unavailable, so the text can be copied by hand. */
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const [artifactUrl, setArtifactUrl] = useState<string | null>(null);
  const [artifactDraft, setArtifactDraft] = useState("");
  const [importText, setImportText] = useState("");
  const [importFilename, setImportFilename] = useState<string | null>(null);
  const [importDescription, setImportDescription] = useState("");
  const [importing, setImporting] = useState(false);

  const loadArtifact = useCallback(() => {
    fetch(`/api/items/${encodeURIComponent(itemId)}/claude-artifact`)
      .then((r) => (r.ok ? r.json() : { url: null }))
      .then((body: { url: string | null }) => setArtifactUrl(body.url))
      .catch(() => setArtifactUrl(null));
  }, [itemId]);

  useEffect(() => {
    setNotice(null);
    setError(null);
    setManualCopy(null);
    loadArtifact();
  }, [loadArtifact]);

  async function copy(format: string, done: string) {
    setNotice(null);
    setError(null);
    setManualCopy(null);
    let text: string;
    try {
      text = await fetchText(exportUrl(target, format, kind));
    } catch (e) {
      setError(`Could not fetch: ${(e as Error).message}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice(done);
    } catch {
      setManualCopy(text);
      setNotice("Clipboard unavailable. Copy the text below by hand.");
    }
  }

  async function saveArtifact(url: string | null) {
    setError(null);
    const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/claude-artifact`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, actor: "Mathew" }),
    });
    if (!res.ok) {
      setError(`Could not save the artifact URL: ${await errorOf(res)}`);
      return;
    }
    setArtifactUrl(((await res.json()) as { url: string | null }).url);
    setArtifactDraft("");
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setImportText(await file.text());
    setImportFilename(file.name);
  }

  async function submitImport() {
    if (!importText.trim()) return;
    setImporting(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: importText,
          filename: importFilename ?? undefined,
          description: importDescription.trim() || undefined,
          requestedBy: "Mathew",
          ...(kind ? { kind } : {}),
        }),
      });
      if (!res.ok) throw new Error(await errorOf(res));
      const proposal = (await res.json()) as { status: string; failure_reason: string | null };
      setNotice(
        proposal.status === "failed"
          ? `Proposal created but delivery failed: ${proposal.failure_reason ?? "unknown"}`
          : "Proposal created from the imported content.",
      );
      setImportText("");
      setImportFilename(null);
      setImportDescription("");
      onProposalCreated?.();
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  }

  const downloads =
    target.type === "doc"
      ? [
          { format: "md", label: "Download .md" },
          { format: "html", label: "Download HTML" },
        ]
      : [
          { format: "mmd", label: "Download .mmd" },
          { format: "svg", label: "Download SVG" },
          { format: "md", label: "Download .md" },
          { format: "html", label: "Download HTML" },
        ];

  return (
    <details className="send-out" data-testid="send-out-panel">
      <summary>Send out</summary>

      {kinds.length > 1 ? (
        <label className="send-out__kind">
          Diagram
          <select value={kind} onChange={(e) => setKind(e.target.value as DiagramKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="send-out__row">
        {downloads.map(({ format, label }) => (
          <a key={format} className="send-out__button" href={exportUrl(target, format, kind)} download>
            {label}
          </a>
        ))}
        <button type="button" className="send-out__button" onClick={() => copy("md", "Copied as markdown.")}>
          Copy as markdown
        </button>
        <button
          type="button"
          className="send-out__button"
          onClick={() =>
            copy("claude-prompt", "Claude prompt copied. Paste it into your Claude Code session to publish and iterate.")
          }
        >
          Open in Claude
        </button>
      </div>

      <div className="send-out__row send-out__artifact">
        {artifactUrl ? (
          <>
            <a href={artifactUrl} target="_blank" rel="noopener noreferrer" data-testid="send-out-artifact-link">
              Claude artifact ↗
            </a>
            <button type="button" className="send-out__button" onClick={() => saveArtifact(null)}>
              Clear
            </button>
          </>
        ) : (
          <>
            <input
              aria-label="Published Claude artifact URL"
              placeholder="https://claude.ai/artifact/…"
              value={artifactDraft}
              onChange={(e) => setArtifactDraft(e.target.value)}
            />
            <button
              type="button"
              className="send-out__button"
              disabled={!artifactDraft.trim()}
              onClick={() => saveArtifact(artifactDraft.trim())}
            >
              Save artifact URL
            </button>
          </>
        )}
      </div>

      <div className="send-out__import">
        <h5>Import back</h5>
        <textarea
          aria-label="Paste the final content"
          placeholder={target.type === "doc" ? "Paste the final .md here…" : "Paste the final .mmd here…"}
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value);
            setImportFilename(null);
          }}
        />
        <div className="send-out__row">
          <input
            type="file"
            aria-label="Upload the final file"
            accept=".md,.markdown,.mmd,.txt,.html"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <input
            aria-label="Import description"
            placeholder="What changed (optional)"
            value={importDescription}
            onChange={(e) => setImportDescription(e.target.value)}
          />
          <button type="button" className="send-out__button" disabled={importing || !importText.trim()} onClick={submitImport}>
            {importing ? "Proposing…" : "Propose change"}
          </button>
        </div>
      </div>

      {notice ? (
        <p className="state" role="status">
          {notice}
        </p>
      ) : null}
      {manualCopy !== null ? (
        <textarea className="send-out__manual-copy" aria-label="Text to copy" readOnly value={manualCopy} />
      ) : null}
      {error ? (
        <p className="state state--err" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
