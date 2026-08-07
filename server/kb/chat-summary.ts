const MAX_CHAT_SUMMARY_LENGTH = 900;

export interface ChatMessage {
  author: string;
  body: string;
}

/**
 * Port of Claud-ometer's chat-store.ts summarizeChat() (REQ-25, see
 * docs/delphi-lineage-inventory.md Source 1): an author-labeled digest of an
 * item's comment thread, capped at 900 chars, so a decision's write-back
 * carries discussion context instead of just the verdict.
 */
export function summarizeChat(comments: ChatMessage[]): string | null {
  if (comments.length === 0) {
    return null;
  }

  const lines = comments.map((c) => `${c.author}: ${c.body}`);
  const digest = `💬 [Consus] Chat context (${comments.length} message${comments.length === 1 ? "" : "s"}): ${lines.join(" | ")}`;

  return digest.length > MAX_CHAT_SUMMARY_LENGTH
    ? `${digest.slice(0, MAX_CHAT_SUMMARY_LENGTH - 1)}…`
    : digest;
}
