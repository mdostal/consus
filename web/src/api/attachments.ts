import { API_BASE_URL } from "../config";
import type { Attachment } from "../components/AttachmentItem";

export interface TicketAttachmentResponse {
  id: string;
  item_id?: string;
  file_name?: string;
  filename?: string;
  mime_type?: string;
  size?: number;
  created_at?: string;
  createdAt?: string;
}

function attachmentApiUrl(id: string): string {
  return `${API_BASE_URL}/api/attachments/${encodeURIComponent(id)}`;
}

export function mapTicketAttachment(attachment: TicketAttachmentResponse): Attachment {
  const filename = attachment.file_name ?? attachment.filename ?? "attachment";
  const url = attachmentApiUrl(attachment.id);
  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(filename);

  return {
    id: attachment.id,
    filename,
    url,
    thumbnailUrl: isImage ? url : undefined,
    size: attachment.size,
    createdAt: attachment.created_at ?? attachment.createdAt,
  };
}

export async function fetchTicketAttachments(ticketId: string): Promise<Attachment[]> {
  const response = await fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(ticketId)}/attachments`);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`Failed to load attachments: ${detail}`);
  }

  const attachments = (await response.json()) as TicketAttachmentResponse[];
  return attachments.map(mapTicketAttachment);
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  const response = await fetch(attachmentApiUrl(attachmentId), { method: "DELETE" });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`Failed to delete attachment: ${detail}`);
  }
}

export function downloadAttachment(attachmentId: string, filename: string): void {
  const link = document.createElement("a");
  link.href = attachmentApiUrl(attachmentId);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
