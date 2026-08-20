import { useCallback, useEffect, useState } from "react";
import { AttachmentUpload } from "./AttachmentUpload";
import { AttachmentList } from "./AttachmentList";
import type { Attachment } from "./types";

// Consus has no auth layer (standalone, local-first) — every other write
// path (postVerdict, submitComment in App.tsx's DecisionView) hardcodes the
// same "Mathew" actor rather than pretending there's a real login. Matches
// that exact convention instead of inventing a new one.
const ACTOR = "Mathew";

export interface AttachmentsPanelProps {
  itemId: string;
}

/**
 * Owns attachment list/upload/delete state for a single decision item,
 * mounted into DecisionView's (App.tsx) expanded detail state — the same
 * "component fetches its own data" pattern DecisionView itself already
 * uses for comments/audit-trail (loadComments/loadAuditTrail), rather than
 * lifting this state further up into App.tsx.
 *
 * Note: DecisionCard.tsx (web/src/features/decisions/DecisionCard.tsx) is
 * NOT the mount point here, despite the story's working title — that
 * component has no item id and is actually the shared go/no-go primitive
 * used by KBBrowser for KB entries, not the Decisions two-pane detail view.
 * The real "expanded/detail state for a decision item" in this codebase is
 * DecisionView (defined in App.tsx, rendered into
 * .decisions-two-pane__detail) — see design-discussion.md's own
 * acknowledgment that the exact mount point wasn't verified before the
 * story was written.
 */
export function AttachmentsPanel({ itemId }: AttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadAttachments = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/attachments`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAttachments(await res.json());
    } catch (e) {
      setListError(`Could not load attachments: ${(e as Error).message}`);
      setAttachments([]);
    }
  }, [itemId]);

  useEffect(() => {
    setAttachments(null);
    loadAttachments();
  }, [loadAttachments]);

  async function handleUpload(file: File) {
    setUploadError(null);
    setIsUploading(true);
    setUploadingFileName(file.name);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("actor", ACTOR);

      const res = await fetch(`/api/items/${itemId}/attachments`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}) as { error?: string })) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      // Re-fetch rather than appending the POST response directly — the
      // create response omits `actor` (see types.ts), and this matches
      // DecisionView's own submitComment -> loadComments() convention: one
      // source of truth for list state, no risk of the appended item's
      // shape drifting from what a real GET returns.
      await loadAttachments();
    } catch (e) {
      setUploadError(`Could not upload file: ${(e as Error).message}`);
    } finally {
      setIsUploading(false);
      setUploadingFileName(null);
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAttachments();
    } catch (e) {
      setDeleteError(`Could not delete attachment: ${(e as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="attachments">
      <AttachmentUpload
        onUpload={handleUpload}
        isUploading={isUploading}
        uploadingFileName={uploadingFileName}
        error={uploadError}
      />

      {deleteError ? <p className="state state--err">{deleteError}</p> : null}

      {attachments === null ? (
        <p className="state">Loading attachments…</p>
      ) : listError ? (
        <p className="state state--err">{listError}</p>
      ) : (
        <AttachmentList attachments={attachments} onDelete={handleDelete} deletingId={deletingId} />
      )}
    </div>
  );
}
