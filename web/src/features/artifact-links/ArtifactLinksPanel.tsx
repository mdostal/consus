import { useCallback, useEffect, useState } from "react";
import { ArtifactLink } from "./ArtifactLink";

export interface ArtifactLinkRecord {
  id: number;
  url: string;
  label: string | null;
}

export interface ArtifactLinksPanelProps {
  itemId: string;
}

/**
 * Owns fetch/list/add state for an item's artifact-links (REQ-05: link only,
 * never re-renders the Artifact's content) — same "component fetches its
 * own data" pattern AttachmentsPanel already uses for a decision item.
 */
export function ArtifactLinksPanel({ itemId }: ArtifactLinksPanelProps) {
  const [links, setLinks] = useState<ArtifactLinkRecord[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  const loadLinks = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/artifact-links`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLinks(await res.json());
    } catch (e) {
      setListError(`Could not load artifact links: ${(e as Error).message}`);
      setLinks([]);
    }
  }, [itemId]);

  useEffect(() => {
    setLinks(null);
    loadLinks();
  }, [loadLinks]);

  async function handleAdd() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    setAddError(null);
    setIsAdding(true);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/artifact-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl, label: label.trim() || undefined }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}) as { error?: string })) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      setUrl("");
      setLabel("");
      // Re-fetch rather than appending locally — matches AttachmentsPanel's
      // own convention: one source of truth for list state.
      await loadLinks();
    } catch (e) {
      setAddError(`Could not add artifact link: ${(e as Error).message}`);
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className="artifact-links">
      <div className="artifact-links__add">
        <input
          aria-label="Artifact URL"
          placeholder="https://claude.ai/artifact/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isAdding}
        />
        <input
          aria-label="Label (optional)"
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={isAdding}
        />
        <button type="button" onClick={handleAdd} disabled={isAdding || !url.trim()}>
          {isAdding ? "Adding…" : "Add link"}
        </button>
      </div>

      {addError ? <p className="state state--err">{addError}</p> : null}

      {links === null ? (
        <p className="state">Loading artifact links…</p>
      ) : listError ? (
        <p className="state state--err">{listError}</p>
      ) : links.length === 0 ? (
        <p className="state">No artifact links yet.</p>
      ) : (
        <ul className="artifact-links__list">
          {links.map((link) => (
            <li key={link.id} className="artifact-links__item">
              <ArtifactLink url={link.url} label={link.label ?? undefined} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
