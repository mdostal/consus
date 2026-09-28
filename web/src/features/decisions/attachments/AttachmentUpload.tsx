import { useCallback, useId, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";

export interface AttachmentUploadProps {
  onUpload: (file: File) => void;
  isUploading: boolean;
  uploadingFileName: string | null;
  error: string | null;
  /** Name of the most recent successful upload, announced to screen readers. */
  lastUploadedFileName?: string | null;
}

/**
 * Ported (with real adaptation, not copy-paste) from origin/feat/PAN-7819's
 * AttachmentUpload.tsx — drag-drop + file-picker upload area. Adapted to:
 *  - this codebase's CSS-class conventions (no inline styles, --consus-*
 *    tokens via app.css) instead of the old branch's inline `style={{}}`.
 *  - a boolean isUploading/uploadingFileName loading indicator instead of
 *    the old branch's XHR-based numeric percentage bar — matches this
 *    codebase's existing boolean-loading-state convention (e.g. ProjectsSection's
 *    `ingesting`, EventsList's `scanning`) rather than introducing a new
 *    XHR upload path just for a byte-level progress number.
 *  - no client-side extension allowlist duplication — the server
 *    (server/routes/attachments.ts) is the single source of truth for
 *    which file types are allowed; this component just surfaces whatever
 *    specific error the server returns.
 */
export function AttachmentUpload({
  onUpload,
  isUploading,
  uploadingFileName,
  error,
  lastUploadedFileName = null,
}: AttachmentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onUpload(file);
    },
    [onUpload],
  );

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    // Reset so choosing the same file again still fires a change event.
    e.target.value = "";
  }

  function openPicker() {
    inputRef.current?.click();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  }

  return (
    <div className="attachments__upload-wrap">
      {/* Kept outside the role="button" dropzone (nesting a focusable input
          inside it is an axe nested-interactive violation) and out of the
          tab order -- the dropzone is the one keyboard stop, and opens this
          picker on Enter/Space. */}
      <input
        ref={inputRef}
        type="file"
        className="attachments__file-input"
        aria-label="Choose a file to upload"
        tabIndex={-1}
        onChange={handleFileInput}
      />
      <div
        className={`attachments__dropzone ${isDragging ? "attachments__dropzone--active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label="Upload attachment"
        aria-describedby={hintId}
      >
        <p id={hintId} className="attachments__dropzone-hint">
          Drag and drop a file here, or click to choose one (max 10MB).
        </p>
      </div>
      {/* Always mounted so screen readers pick up the change -- a live region
          that appears together with its first message is often not announced. */}
      <div role="status" aria-live="polite" className="attachments__status">
        {isUploading ? (
          <p className="state">Uploading {uploadingFileName ?? "file"}…</p>
        ) : lastUploadedFileName ? (
          <span className="visually-hidden">Uploaded {lastUploadedFileName}.</span>
        ) : null}
      </div>
      {error ? (
        <p className="state state--err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
