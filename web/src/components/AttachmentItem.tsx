import React, { useState } from 'react';
import { getFileIcon } from '../utils/fileIcons';

export interface Attachment {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl?: string;
  size?: number;
  createdAt?: string;
}

interface AttachmentItemProps {
  attachment: Attachment;
  onDownload: (id: string, filename: string) => void;
  onDelete: (id: string, filename: string) => void;
}

function formatSize(bytes?: number) {
  if (bytes === undefined) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateString?: string) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AttachmentItem({ attachment, onDownload, onDelete }: AttachmentItemProps) {
  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(attachment.filename);

  return (
    <div
      className="attachment-item"
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px',
        border: '1px solid #eee',
        borderRadius: '6px',
        marginBottom: '8px',
        backgroundColor: '#fff',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          marginRight: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isImage && attachment.thumbnailUrl ? (
          <img
            src={attachment.thumbnailUrl}
            alt={attachment.filename}
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '4px', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          getFileIcon(attachment.filename)
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, marginRight: '16px' }}>
        <div
          style={{
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: '#333',
            fontSize: '14px',
          }}
          title={attachment.filename}
        >
          {attachment.filename}
        </div>
        {(attachment.size !== undefined || attachment.createdAt) && (
          <div style={{ fontSize: '12px', color: '#777', marginTop: '4px' }}>
            {formatSize(attachment.size)}
            {attachment.size !== undefined && attachment.createdAt ? ' • ' : ''}
            {formatDate(attachment.createdAt)}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={() => onDownload(attachment.id, attachment.filename)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '6px',
            color: '#1976d2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
          }}
          title="Download"
          aria-label={`Download ${attachment.filename}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
        </button>
        <button
          onClick={() => onDelete(attachment.id, attachment.filename)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '6px',
            color: '#d32f2f',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
          }}
          title="Delete"
          aria-label={`Delete ${attachment.filename}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
