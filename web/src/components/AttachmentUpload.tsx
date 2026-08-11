import React, { useState, useRef, useCallback } from 'react';
import { useFileUpload } from '../hooks/useFileUpload';
import { validateFile } from '../utils/fileValidation';
import { UploadProgress } from './UploadProgress';
import { SkeletonLoader } from './SkeletonLoader';

export interface AttachmentUploadProps {
  ticketId?: string;
  onUploadSuccess?: (attachment: any) => void;
}

export function AttachmentUpload({ ticketId, onUploadSuccess }: AttachmentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { upload, progress, isUploading, error: uploadError } = useFileUpload({ ticketId });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const processFile = async (file: File) => {
    setValidationError(null);
    setCurrentFile(file);

    const validation = validateFile(file);
    if (!validation.valid) {
      setValidationError(validation.error || 'Invalid file');
      return;
    }

    try {
      const result = await upload(file);
      if (onUploadSuccess) {
        onUploadSuccess(result);
      }
      setTimeout(() => {
        setCurrentFile(null); // Clear after a delay to show 100%
      }, 1500);
    } catch (e) {
      // Error is handled by the hook and displayed
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        processFile(file);
        e.dataTransfer.clearData();
      }
    },
    [upload, onUploadSuccess]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      processFile(file);
      // Reset input value so the same file can be uploaded again if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div
      style={{
        border: `2px dashed ${isDragging ? '#4caf50' : '#ccc'}`,
        backgroundColor: isDragging ? '#e8f5e9' : '#fafafa',
        padding: '20px',
        textAlign: 'center',
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className="interactive transition-colors"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
      role="button"
      aria-label="Upload attachment by dragging or clicking"
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInput}
        style={{ display: 'none' }}
        aria-label="Upload file"
      />
      <p style={{ margin: 0, color: '#666' }}>
        Drag and drop a file here, or click to select
      </p>

      {validationError && (
        <div style={{ color: 'red', marginTop: '10px' }} role="alert">
          {validationError}
        </div>
      )}

      {currentFile && isUploading && progress === 0 && !uploadError && (
        <div style={{ marginTop: '10px' }} onClick={(e) => e.stopPropagation()}>
          <SkeletonLoader height="32px" />
        </div>
      )}

      {currentFile && (isUploading && progress > 0 || progress === 100 || uploadError) && (
        <div onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
          <UploadProgress
            progress={progress}
            fileName={currentFile.name}
            error={uploadError}
          />
        </div>
      )}
    </div>
  );
}
