import { useEffect, useState } from "react";
import { AttachmentList } from "../../components/AttachmentList";
import { AttachmentUpload } from "../../components/AttachmentUpload";
import type { Attachment } from "../../components/AttachmentItem";
import {
  deleteAttachment,
  downloadAttachment,
  fetchTicketAttachments,
  mapTicketAttachment,
  type TicketAttachmentResponse,
} from "../../api/attachments";

export interface DecisionAttachmentsProps {
  itemId: string;
}

export function DecisionAttachments({ itemId }: DecisionAttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchTicketAttachments(itemId)
      .then((nextAttachments) => {
        if (!cancelled) {
          setAttachments(nextAttachments);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load attachments.");
          setAttachments([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  function handleUploadSuccess(uploaded: TicketAttachmentResponse) {
    if (!uploaded?.id) return;
    const nextAttachment = mapTicketAttachment(uploaded);
    setAttachments((current) => [nextAttachment, ...current.filter((attachment) => attachment.id !== nextAttachment.id)]);
  }

  async function handleDelete(attachmentId: string) {
    setError(null);
    try {
      await deleteAttachment(attachmentId);
      setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete attachment.");
    }
  }

  return (
    <section className="decision-attachments" data-testid="decision-attachments" aria-labelledby="decision-attachments-title">
      <h3 id="decision-attachments-title" className="decision-attachments__title">
        Attachments
      </h3>
      <AttachmentUpload ticketId={itemId} onUploadSuccess={handleUploadSuccess} />
      {isLoading ? (
        <p className="decision-attachments__status">Loading attachments...</p>
      ) : error ? (
        <p className="decision-attachments__status decision-attachments__status--error" role="alert">
          {error}
        </p>
      ) : null}
      <AttachmentList
        attachments={attachments}
        onDownloadAttachment={downloadAttachment}
        onDeleteAttachment={handleDelete}
      />
    </section>
  );
}
