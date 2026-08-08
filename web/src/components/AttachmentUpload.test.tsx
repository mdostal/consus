import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttachmentUpload } from './AttachmentUpload';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../hooks/useFileUpload', () => {
  return {
    useFileUpload: () => ({
      upload: vi.fn().mockResolvedValue({ id: '123' }),
      progress: 50,
      isUploading: true,
      error: null,
    }),
  };
});

describe('AttachmentUpload', () => {
  it('renders correctly', () => {
    render(<AttachmentUpload />);
    expect(screen.getByText(/Drag and drop a file here/i)).toBeDefined();
  });

  it('highlights on drag over', () => {
    render(<AttachmentUpload />);
    const dropzone = screen.getByText(/Drag and drop a file here/i).parentElement!;
    fireEvent.dragOver(dropzone);
    expect(dropzone.style.backgroundColor).toBe('rgb(232, 245, 233)'); // #e8f5e9
  });

  it('validates large files', async () => {
    render(<AttachmentUpload />);
    const file = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.png', { type: 'image/png' });
    const dropzone = screen.getByText(/Drag and drop a file here/i).parentElement!;

    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
        clearData: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/File size exceeds 10MB limit/i)).toBeDefined();
    });
  });

  it('validates disallowed file types', async () => {
    render(<AttachmentUpload />);
    const file = new File(['content'], 'test.exe', { type: 'application/x-msdownload' });
    const dropzone = screen.getByText(/Drag and drop a file here/i).parentElement!;

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
        clearData: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/File type not allowed/i)).toBeDefined();
    });
  });
});
