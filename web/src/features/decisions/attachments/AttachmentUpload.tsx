import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";

export interface AttachmentUploadProps {
  onUpload: (file: File) => void;
  isUploading: boolean;
  uploadingFileName: string | null;
  error: string | null;
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
export function AttachmentUpload({ onUpload, isUploading, uploadingFileName, error }: AttachmentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
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
      >
        <input
          ref={inputRef}
          type="file"
          className="attachments__file-input"
          aria-label="Choose a file to upload"
          onChange={handleFileInput}
        />
        <p className="attachments__dropzone-hint">Drag and drop a file here, or click to choose one (max 10MB).</p>
      </div>

      {isUploading ? (
        <p className="state" role="status">
          Uploading {uploadingFileName ?? "file"}…
        </p>
      ) : null}

      {error ? <p className="state state--err">{error}</p> : null}
    </div>
  );
}
