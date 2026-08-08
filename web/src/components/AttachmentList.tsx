import React, { useState } from 'react';
import { Attachment, AttachmentItem } from './AttachmentItem';
import { DeleteConfirmModal } from './DeleteConfirmModal';

interface AttachmentListProps {
  attachments: Attachment[];
  onDownloadAttachment: (id: string, filename: string) => void;
  onDeleteAttachment: (id: string) => void;
}

export function AttachmentList({
  attachments,
  onDownloadAttachment,
  onDeleteAttachment,
}: AttachmentListProps) {
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    attachmentId: string | null;
    filename: string;
  }>({
    isOpen: false,
    attachmentId: null,
    filename: '',
  });

  if (!attachments || attachments.length === 0) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: '#777', fontStyle: 'italic' }}>
        No attachments
      </div>
    );
  }

  const handleDeleteClick = (id: string, filename: string) => {
    setDeleteModalState({
      isOpen: true,
      attachmentId: id,
      filename,
    });
  };

  const confirmDelete = () => {
    if (deleteModalState.attachmentId) {
      onDeleteAttachment(deleteModalState.attachmentId);
    }
    setDeleteModalState({ isOpen: false, attachmentId: null, filename: '' });
  };

  const cancelDelete = () => {
    setDeleteModalState({ isOpen: false, attachmentId: null, filename: '' });
  };

  return (
    <div style={{ marginTop: '16px' }}>
      <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#333' }}>
        Attachments ({attachments.length})
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {attachments.map((attachment) => (
          <AttachmentItem
            key={attachment.id}
            attachment={attachment}
            onDownload={onDownloadAttachment}
            onDelete={handleDeleteClick}
          />
        ))}
      </div>

      <DeleteConfirmModal
        isOpen={deleteModalState.isOpen}
        filename={deleteModalState.filename}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}
