import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AttachmentItem } from "./AttachmentItem";
import type { Attachment } from "./types";

const ATTACHMENT: Attachment = {
  id: "att-1",
  item_id: "item-1",
  file_name: "spec.pdf",
  mime_type: "application/pdf",
  size: 2048,
  actor: "Mathew",
  created_at: "2026-08-12T00:00:00Z",
};

const IMAGE_ATTACHMENT: Attachment = {
  id: "att-2",
  item_id: "item-1",
  file_name: "screenshot.png",
  mime_type: "image/png",
  size: 4096,
  actor: "Mathew",
  created_at: "2026-08-12T00:00:00Z",
};

describe("AttachmentItem", () => {
  it("renders the file name, a type indicator, and a human-readable size", () => {
    render(<AttachmentItem attachment={ATTACHMENT} onDelete={vi.fn()} isDeleting={false} />);

    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
  });

  it("has a download control pointing at GET /api/attachments/:id with the original filename", () => {
    render(<AttachmentItem attachment={ATTACHMENT} onDelete={vi.fn()} isDeleting={false} />);

    const link = screen.getByRole("link", { name: /download spec\.pdf/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/attachments/att-1");
    expect(link.getAttribute("download")).toBe("spec.pdf");
  });

  it("requires a confirmation step before onDelete fires — one click never deletes", () => {
    const onDelete = vi.fn();
    render(<AttachmentItem attachment={ATTACHMENT} onDelete={onDelete} isDeleting={false} />);

    fireEvent.click(screen.getByRole("button", { name: /delete spec\.pdf/i }));
    expect(onDelete).not.toHaveBeenCalled();

    expect(screen.getByRole("button", { name: /confirm delete/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(onDelete).toHaveBeenCalledWith("att-1");
  });

  it("lets the operator cancel out of the confirmation without deleting", () => {
    const onDelete = vi.fn();
    render(<AttachmentItem attachment={ATTACHMENT} onDelete={onDelete} isDeleting={false} />);

    fireEvent.click(screen.getByRole("button", { name: /delete spec\.pdf/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /delete spec\.pdf/i })).toBeInTheDocument();
  });

  it("renders an inline <img> preview for image mime types, sourced from the attachment endpoint", () => {
    render(<AttachmentItem attachment={IMAGE_ATTACHMENT} onDelete={vi.fn()} isDeleting={false} />);

    const img = screen.getByRole("img", { name: "screenshot.png" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/attachments/att-2");
    expect(screen.queryByText("PNG")).not.toBeInTheDocument();
  });

  it("leaves non-image mime types rendering the existing pill+download markup, with no <img>", () => {
    render(<AttachmentItem attachment={ATTACHMENT} onDelete={vi.fn()} isDeleting={false} />);

    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /download spec\.pdf/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/attachments/att-1");
  });

  it("falls back to the pill+download rendering when the image preview fails to load", () => {
    render(<AttachmentItem attachment={IMAGE_ATTACHMENT} onDelete={vi.fn()} isDeleting={false} />);

    const img = screen.getByRole("img", { name: "screenshot.png" });
    fireEvent.error(img);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("PNG")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /download screenshot\.png/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/attachments/att-2");
  });
});
