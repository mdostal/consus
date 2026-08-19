/** Matches GET /api/items/:id/attachments and the POST create response
 *  shape from server/routes/attachments.ts (s1-attachment-storage-and-api).
 *  Note the POST create response omits `actor` — callers should re-fetch
 *  the list (loadAttachments) rather than relying on the POST response
 *  shape matching this type exactly, the same convention DecisionView
 *  already uses for comments (submitComment -> loadComments()). */
export interface Attachment {
  id: string;
  item_id: string;
  file_name: string;
  mime_type: string;
  size: number;
  actor: string;
  created_at: string;
}
