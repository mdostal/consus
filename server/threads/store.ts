import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ThreadNotifier } from "./notifier.js";

/**
 * d4-consus-threads-generic (PANT-962): comment threads an outside agent can
 * answer. A thread attaches to any item by a generic (itemType, itemId) pair
 * plus an optional anchor (section, line range, diagram node, ...). Every
 * operator message is sent out once through a ThreadNotifier; the agent's
 * answer comes back through POST /api/threads/:id/replies. Consus never
 * applies the change itself — a reply can only *link* a proposal.
 *
 * The wire contract lives in docs/agent-integration/threads.md.
 */

export type ThreadRole = "operator" | "agent";
export type DeliveryStatus = "pending" | "delivered" | "failed";

/** Where a thread stands, derived from its last message:
 *  - awaiting_agent: last message is the operator's and it was (or is being) sent
 *  - delivery_failed: last message is the operator's and it never reached an agent
 *  - answered: last message is an agent reply */
export type ThreadState = "awaiting_agent" | "delivery_failed" | "answered";

/** Free-form JSON object locating the thread inside its item. Recommended
 *  keys (documented, not enforced): section, line, lineEnd, nodeId, quote. */
export type ThreadAnchor = Record<string, unknown>;

export interface ThreadProposalSummary {
  id: string;
  status: string;
  description: string;
  targetType: string;
}

export interface ThreadMessage {
  id: number;
  threadId: string;
  role: ThreadRole;
  author: string;
  body: string;
  proposalId: string | null;
  proposalUrl: string | null;
  /** Resolved when proposalId names a proposal in this Consus instance. */
  proposal: ThreadProposalSummary | null;
  /** Outbound delivery of an operator message; null on agent replies. */
  delivery: { status: DeliveryStatus; error: string | null; target: string | null; attemptedAt: string | null } | null;
  createdAt: string;
}

export interface Thread {
  id: string;
  itemType: string;
  itemId: string;
  anchor: ThreadAnchor | null;
  state: ThreadState;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

/** How many earlier messages ride along in an outbound event's `context`. */
export const THREAD_CONTEXT_LIMIT = 10;

const ITEM_TYPE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_ANCHOR_BYTES = 2048;

export function validateItemType(itemType: unknown): itemType is string {
  return typeof itemType === "string" && ITEM_TYPE_RE.test(itemType);
}

/** Returns an error message, or null when the anchor is acceptable. */
export function anchorError(anchor: unknown): string | null {
  if (anchor === undefined || anchor === null) return null;
  if (typeof anchor !== "object" || Array.isArray(anchor)) return "anchor must be a JSON object";
  if (JSON.stringify(anchor).length > MAX_ANCHOR_BYTES) return `anchor must be at most ${MAX_ANCHOR_BYTES} bytes`;
  return null;
}

interface ThreadRow {
  id: string;
  item_type: string;
  item_id: string;
  anchor: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  thread_id: string;
  role: ThreadRole;
  author: string;
  body: string;
  proposal_id: string | null;
  proposal_url: string | null;
  delivery_status: DeliveryStatus | null;
  delivery_error: string | null;
  delivery_target: string | null;
  delivery_attempted_at: string | null;
  created_at: string;
}

function lookupProposal(db: Database.Database, proposalId: string | null): ThreadProposalSummary | null {
  if (!proposalId) return null;
  const row = db
    .prepare("SELECT id, status, description, target_type AS targetType FROM proposals WHERE id = ?")
    .get(proposalId) as ThreadProposalSummary | undefined;
  return row ?? null;
}

function toMessage(db: Database.Database, row: MessageRow): ThreadMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    author: row.author,
    body: row.body,
    proposalId: row.proposal_id,
    proposalUrl: row.proposal_url,
    proposal: lookupProposal(db, row.proposal_id),
    delivery:
      row.role === "operator" && row.delivery_status
        ? {
            status: row.delivery_status,
            error: row.delivery_error,
            target: row.delivery_target,
            attemptedAt: row.delivery_attempted_at,
          }
        : null,
    createdAt: row.created_at,
  };
}

function stateOf(messages: ThreadMessage[]): ThreadState {
  const last = messages[messages.length - 1];
  if (!last || last.role === "agent") return "answered";
  return last.delivery?.status === "failed" ? "delivery_failed" : "awaiting_agent";
}

function toThread(db: Database.Database, row: ThreadRow): Thread {
  const messages = (
    db.prepare("SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY id ASC").all(row.id) as MessageRow[]
  ).map((m) => toMessage(db, m));
  return {
    id: row.id,
    itemType: row.item_type,
    itemId: row.item_id,
    anchor: row.anchor ? (JSON.parse(row.anchor) as ThreadAnchor) : null,
    state: stateOf(messages),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
  };
}

export function getThread(db: Database.Database, threadId: string): Thread | null {
  const row = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
  return row ? toThread(db, row) : null;
}

export function listThreads(db: Database.Database, filter: { itemType?: string; itemId?: string }): Thread[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.itemType) {
    where.push("item_type = ?");
    args.push(filter.itemType);
  }
  if (filter.itemId) {
    where.push("item_id = ?");
    args.push(filter.itemId);
  }
  const sql = `SELECT * FROM threads${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at ASC, id ASC`;
  return (db.prepare(sql).all(...args) as ThreadRow[]).map((r) => toThread(db, r));
}

export interface NewMessageInput {
  role: ThreadRole;
  author: string;
  body: string;
  proposalId?: string | null;
  proposalUrl?: string | null;
}

/** Appends a message and bumps the thread's updated_at. Operator messages
 *  start 'pending' delivery; agent replies have no delivery state. */
export function addMessage(db: Database.Database, threadId: string, input: NewMessageInput): number {
  const now = new Date().toISOString();
  let id = 0;
  db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO thread_messages (thread_id, role, author, body, proposal_id, proposal_url, delivery_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        input.role,
        input.author,
        input.body,
        input.proposalId ?? null,
        input.proposalUrl ?? null,
        input.role === "operator" ? "pending" : null,
        now,
      );
    id = Number(info.lastInsertRowid);
    db.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(now, threadId);
  })();
  return id;
}

export function createThread(
  db: Database.Database,
  input: { itemType: string; itemId: string; anchor?: ThreadAnchor | null; author: string; body: string },
): { threadId: string; messageId: number } {
  const threadId = randomUUID();
  const now = new Date().toISOString();
  let messageId = 0;
  db.transaction(() => {
    db.prepare("INSERT INTO threads (id, item_type, item_id, anchor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      threadId,
      input.itemType,
      input.itemId,
      input.anchor ? JSON.stringify(input.anchor) : null,
      now,
      now,
    );
    messageId = addMessage(db, threadId, { role: "operator", author: input.author, body: input.body });
  })();
  return { threadId, messageId };
}

/** The outbound event sent for every operator message — the payload
 *  contract in docs/agent-integration/threads.md. */
export interface ThreadMessageEvent {
  type: "consus.thread.message";
  version: 1;
  threadId: string;
  item: { type: string; id: string };
  anchor: ThreadAnchor | null;
  message: { id: number; role: ThreadRole; author: string; body: string; createdAt: string };
  /** Up to THREAD_CONTEXT_LIMIT earlier messages, oldest first. */
  context: Array<{ id: number; role: ThreadRole; author: string; body: string; proposalId: string | null; createdAt: string }>;
  replyUrl: string;
}

export function buildMessageEvent(thread: Thread, messageId: number, baseUrl: string): ThreadMessageEvent | null {
  const index = thread.messages.findIndex((m) => m.id === messageId);
  if (index === -1) return null;
  const message = thread.messages[index];
  const earlier = thread.messages.slice(Math.max(0, index - THREAD_CONTEXT_LIMIT), index);
  return {
    type: "consus.thread.message",
    version: 1,
    threadId: thread.id,
    item: { type: thread.itemType, id: thread.itemId },
    anchor: thread.anchor,
    message: { id: message.id, role: message.role, author: message.author, body: message.body, createdAt: message.createdAt },
    context: earlier.map((m) => ({
      id: m.id,
      role: m.role,
      author: m.author,
      body: m.body,
      proposalId: m.proposalId,
      createdAt: m.createdAt,
    })),
    replyUrl: `${baseUrl.replace(/\/+$/, "")}/api/threads/${encodeURIComponent(thread.id)}/replies`,
  };
}

/**
 * One delivery attempt for an operator message. Records the outcome on the
 * message row (delivered, or failed with the reason) — no retry loop; a
 * failed message is retried by hand via POST /api/threads/:id/redeliver.
 */
export async function deliverMessage(
  db: Database.Database,
  notifier: ThreadNotifier,
  threadId: string,
  messageId: number,
  baseUrl: string,
): Promise<void> {
  const thread = getThread(db, threadId);
  const event = thread ? buildMessageEvent(thread, messageId, baseUrl) : null;
  if (!event) return;
  const result = await notifier.notify(event);
  db.prepare(
    `UPDATE thread_messages
        SET delivery_status = ?, delivery_error = ?, delivery_target = ?, delivery_attempted_at = ?
      WHERE id = ?`,
  ).run(
    result.ok ? "delivered" : "failed",
    result.ok ? null : result.error,
    notifier.target,
    new Date().toISOString(),
    messageId,
  );
}

/** The latest operator message, if it is the one awaiting a (re)delivery. */
export function lastFailedOperatorMessage(thread: Thread): ThreadMessage | null {
  const last = thread.messages[thread.messages.length - 1];
  return last && last.role === "operator" && last.delivery?.status === "failed" ? last : null;
}
