import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AttachmentList } from './AttachmentList';

const mockAttachments = [
  {
    id: '1',
    filename: 'document.pdf',
    url: 'http://example.com/doc.pdf',
    size: 1024 * 1024,
    createdAt: '2026-08-08T10:00:00Z',
  },
  {
    id: '2',
    filename: 'image.png',
    url: 'http://example.com/img.png',
    thumbnailUrl: 'http://example.com/thumb.png',
    size: 512 * 1024,
    createdAt: '2026-08-08T11:00:00Z',
  },
];

describe('AttachmentList', () => {
  it('renders a list of attachments', () => {
    const handleDownload = vi.fn();
    const handleDelete = vi.fn();
    
    render(
      <AttachmentList
        attachments={mockAttachments}
        onDownloadAttachment={handleDownload}
        onDeleteAttachment={handleDelete}
      />
    );

    expect(screen.getByText('document.pdf')).toBeInTheDocument();
    expect(screen.getByText('image.png')).toBeInTheDocument();
    expect(screen.getByText('Attachments (2)')).toBeInTheDocument();
  });

  it('renders thumbnail preview for image attachments', () => {
    render(
      <AttachmentList
        attachments={[mockAttachments[1]]}
        onDownloadAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
      />
    );

    const img = screen.getByAltText('image.png');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'http://example.com/thumb.png');
  });

  it('renders file icon for document attachments', () => {
    const { container } = render(
      <AttachmentList
        attachments={[mockAttachments[0]]}
        onDownloadAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
      />
    );

    // Look for SVG icon since it's a PDF
    const svg = container.querySelector('svg[color="#d32f2f"]');
    expect(svg).toBeInTheDocument();
  });

  it('calls onDownloadAttachment with correct parameters when download icon is clicked', () => {
    const handleDownload = vi.fn();
    render(
      <AttachmentList
        attachments={[mockAttachments[0]]}
        onDownloadAttachment={handleDownload}
        onDeleteAttachment={vi.fn()}
      />
    );

    const downloadButton = screen.getByTitle('Download');
    fireEvent.click(downloadButton);

    expect(handleDownload).toHaveBeenCalledWith('1', 'document.pdf');
  });

  it('shows confirmation modal before deletion', () => {
    const handleDelete = vi.fn();
    render(
      <AttachmentList
        attachments={[mockAttachments[0]]}
        onDownloadAttachment={vi.fn()}
        onDeleteAttachment={handleDelete}
      />
    );

    const deleteButton = screen.getByTitle('Delete');
    fireEvent.click(deleteButton);

    // Modal should be visible
    expect(screen.getByText('Delete Attachment')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
    expect(screen.getAllByText('document.pdf').length).toBeGreaterThan(0);

    // Confirm deletion
    const confirmButton = screen.getByText('Delete', { selector: 'button' });
    fireEvent.click(confirmButton);

    expect(handleDelete).toHaveBeenCalledWith('1');
    // Modal should close
    expect(screen.queryByText('Delete Attachment')).not.toBeInTheDocument();
  });

  it('cancels deletion when cancel is clicked in modal', () => {
    const handleDelete = vi.fn();
    render(
      <AttachmentList
        attachments={[mockAttachments[0]]}
        onDownloadAttachment={vi.fn()}
        onDeleteAttachment={handleDelete}
      />
    );

    const deleteButton = screen.getByTitle('Delete');
    fireEvent.click(deleteButton);

    // Modal should be visible
    expect(screen.getByText('Delete Attachment')).toBeInTheDocument();

    // Cancel deletion
    const cancelButton = screen.getByText('Cancel', { selector: 'button' });
    fireEvent.click(cancelButton);

    expect(handleDelete).not.toHaveBeenCalled();
    // Modal should close
    expect(screen.queryByText('Delete Attachment')).not.toBeInTheDocument();
  });
});
