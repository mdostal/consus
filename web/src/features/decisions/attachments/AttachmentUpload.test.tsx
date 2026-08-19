import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AttachmentUpload } from "./AttachmentUpload";

function makeFile(name: string, content = "hello", type = "text/plain") {
  return new File([content], name, { type });
}

describe("AttachmentUpload", () => {
  it("shows a drag-drop area with a way to pick a file even with no attachments yet", () => {
    render(<AttachmentUpload onUpload={vi.fn()} isUploading={false} uploadingFileName={null} error={null} />);

    expect(screen.getByRole("button", { name: /upload attachment/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/choose a file to upload/i)).toBeInTheDocument();
  });

  it("calls onUpload with the file chosen via the file picker", () => {
    const onUpload = vi.fn();
    render(<AttachmentUpload onUpload={onUpload} isUploading={false} uploadingFileName={null} error={null} />);

    const file = makeFile("spec.pdf", "content", "application/pdf");
    const input = screen.getByLabelText(/choose a file to upload/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0].name).toBe("spec.pdf");
  });

  it("calls onUpload with the file dropped onto the dropzone", () => {
    const onUpload = vi.fn();
    render(<AttachmentUpload onUpload={onUpload} isUploading={false} uploadingFileName={null} error={null} />);

    const file = makeFile("screenshot.png", "content", "image/png");
    const dropzone = screen.getByRole("button", { name: /upload attachment/i });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0].name).toBe("screenshot.png");
  });

  it("shows a visible uploading state with the file name while an upload is in flight", () => {
    render(
      <AttachmentUpload onUpload={vi.fn()} isUploading={true} uploadingFileName="report.pdf" error={null} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/uploading report\.pdf/i);
  });

  it("shows a specific error message when the upload fails, not a generic message", () => {
    render(
      <AttachmentUpload
        onUpload={vi.fn()}
        isUploading={false}
        uploadingFileName={null}
        error="Could not upload file: File type not allowed"
      />,
    );

    expect(screen.getByText(/file type not allowed/i)).toBeInTheDocument();
  });
});
