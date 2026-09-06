import { useState } from "react";
import type { Attachment } from "./types";

export interface AttachmentItemProps {
  attachment: Attachment;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A short uppercase extension pill (e.g. "PDF", "PNG") instead of an icon
 *  asset — no SVG/emoji icon set exists anywhere in this codebase today
 *  (unlike the old branch's getFileIcon()), so this matches the existing
 *  small-uppercase-pill visual language already used for status/type
 *  (.dv__pill, .decision-list__row-type) rather than introducing one. */
function fileExtensionLabel(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1 || dot === fileName.length - 1) return "FILE";
  return fileName.slice(dot + 1).toUpperCase();
}

export function AttachmentItem({ attachment, onDelete, isDeleting }: AttachmentItemProps) {
  const [confirming, setConfirming] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  // GET /api/attachments/:id already serves image/* mime types with
  // Content-Disposition: inline (server/routes/attachments.ts
  // INLINE_SAFE_TYPES) — reuse that same URL for a thumbnail rather than
  // the generic extension pill. Any load failure (404, corrupt data) falls
  // back to the pill via onError, same as every other mime type.
  const isImage = attachment.mime_type.startsWith("image/");
  const showPreview = isImage && !previewFailed;

  return (
    <li className="attachments__item" data-testid={`attachment-${attachment.id}`}>
      {showPreview ? (
        <img
          className="attachments__thumbnail"
          src={`/api/attachments/${attachment.id}`}
          alt={attachment.file_name}
          style={{ flex: "none", width: 40, height: 40, objectFit: "cover", borderRadius: 6 }}
          onError={() => setPreviewFailed(true)}
        />
      ) : (
        <span className="attachments__type-pill">{fileExtensionLabel(attachment.file_name)}</span>
      )}

      <div className="attachments__item-meta">
        <span className="attachments__item-name" title={attachment.file_name}>
          {attachment.file_name}
        </span>
        <span className="attachments__item-size">{formatSize(attachment.size)}</span>
      </div>

      <div className="attachments__item-actions">
        {/* GET /api/attachments/:id serves Content-Disposition: inline, so
         *  a plain <a href> could just open the file in-tab depending on
         *  its mime type. The `download` attribute forces a real browser
         *  download with the original filename regardless — same-origin,
         *  no JS/fetch round trip needed. */}
        <a
          className="attachments__download"
          href={`/api/attachments/${attachment.id}`}
          download={attachment.file_name}
          aria-label={`Download ${attachment.file_name}`}
        >
          Download
        </a>

        {confirming ? (
          <span className="attachments__confirm">
            <button
              type="button"
              className="attachments__delete-confirm"
              disabled={isDeleting}
              onClick={() => {
                setConfirming(false);
                onDelete(attachment.id);
              }}
            >
              {isDeleting ? "Deleting…" : "Confirm delete"}
            </button>
            <button type="button" className="attachments__delete-cancel" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="attachments__delete"
            aria-label={`Delete ${attachment.file_name}`}
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
