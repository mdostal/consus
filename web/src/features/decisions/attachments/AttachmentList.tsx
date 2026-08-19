import { AttachmentItem } from "./AttachmentItem";
import type { Attachment } from "./types";

export interface AttachmentListProps {
  attachments: Attachment[];
  onDelete: (id: string) => void;
  deletingId: string | null;
}

export function AttachmentList({ attachments, onDelete, deletingId }: AttachmentListProps) {
  if (attachments.length === 0) {
    return (
      <div className="empty attachments__empty">
        <strong>No attachments yet</strong>
        Drag a file above or use the file picker to attach supporting context.
      </div>
    );
  }

  return (
    <ul className="attachments__list" aria-label={`Attachments (${attachments.length})`}>
      {attachments.map((attachment) => (
        <AttachmentItem
          key={attachment.id}
          attachment={attachment}
          onDelete={onDelete}
          isDeleting={deletingId === attachment.id}
        />
      ))}
    </ul>
  );
}
