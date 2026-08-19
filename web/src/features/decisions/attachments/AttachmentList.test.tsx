import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttachmentList } from "./AttachmentList";
import type { Attachment } from "./types";

function makeAttachment(id: string, file_name: string): Attachment {
  return {
    id,
    item_id: "item-1",
    file_name,
    mime_type: "application/pdf",
    size: 1024,
    actor: "Mathew",
    created_at: "2026-08-12T00:00:00Z",
  };
}

describe("AttachmentList", () => {
  it("shows an empty state when there are zero attachments", () => {
    render(<AttachmentList attachments={[]} onDelete={vi.fn()} deletingId={null} />);

    expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument();
  });

  it("renders all N attachments when there are several", () => {
    const attachments = [
      makeAttachment("att-1", "one.pdf"),
      makeAttachment("att-2", "two.png"),
      makeAttachment("att-3", "three.csv"),
    ];
    render(<AttachmentList attachments={attachments} onDelete={vi.fn()} deletingId={null} />);

    expect(screen.getByText("one.pdf")).toBeInTheDocument();
    expect(screen.getByText("two.png")).toBeInTheDocument();
    expect(screen.getByText("three.csv")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
