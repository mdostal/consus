import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ServerResponse } from "node:http";
import type Database from "better-sqlite3";
import { ThreadBus } from "../threads/bus.js";
import type { ThreadNotifier } from "../threads/notifier.js";
import {
  addMessage,
  anchorError,
  createThread,
  deliverMessage,
  getThread,
  lastFailedOperatorMessage,
  listThreads,
  validateItemType,
  type Thread,
  type ThreadAnchor,
} from "../threads/store.js";

export interface ThreadRoutesOptions {
  db: Database.Database;
  notifier: ThreadNotifier;
  /** Base URL written into each outbound event's replyUrl. Falls back to the
   *  request's own protocol + host when unset (CONSUS_PUBLIC_URL). */
  publicUrl?: string;
  bus?: ThreadBus;
}

// Matches every other write path: no auth layer, one local operator.
const DEFAULT_OPERATOR = "Mathew";

interface CreateThreadBody {
  itemType?: string;
  itemId?: string;
  anchor?: ThreadAnchor | null;
  author?: string;
  body?: string;
}

interface ReplyBody {
  author?: string;
  body?: string;
  proposalId?: string;
  proposalUrl?: string;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Agent-answerable comment threads (PANT-962). The operator writes through
 * POST /api/threads and /api/threads/:id/messages, each of which sends one
 * outbound event; an agent answers through POST /api/threads/:id/replies.
 * GET /api/threads/stream pushes every change to the UI over SSE.
 * Contract: docs/agent-integration/threads.md.
 */
export function registerThreadRoutes(app: FastifyInstance, { db, notifier, publicUrl, bus = new ThreadBus() }: ThreadRoutesOptions): void {
  const baseUrlFor = (request: FastifyRequest) => publicUrl ?? `${request.protocol}://${request.host}`;

  function publish(threadId: string): Thread | null {
    const thread = getThread(db, threadId);
    if (thread) bus.publish(thread);
    return thread;
  }

  async function sendOut(request: FastifyRequest, threadId: string, messageId: number): Promise<Thread | null> {
    // Publish the pending state first so an open UI shows "sending" at once.
    publish(threadId);
    await deliverMessage(db, notifier, threadId, messageId, baseUrlFor(request));
    return publish(threadId);
  }

  app.get<{ Querystring: { itemType?: string; itemId?: string } }>("/api/threads", async (request) => {
    const { itemType, itemId } = request.query;
    return listThreads(db, { itemType, itemId });
  });

  // Registered before /api/threads/:id so "stream" is never read as an id.
  const streams = new Set<ServerResponse>();
  app.get<{ Querystring: { itemType?: string; itemId?: string } }>("/api/threads/stream", (request, reply) => {
    const { itemType, itemId } = request.query;
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.write("retry: 3000\n\n");
    const unsubscribe = bus.subscribe((thread) => {
      if (itemType && thread.itemType !== itemType) return;
      if (itemId && thread.itemId !== itemId) return;
      raw.write(`event: thread\ndata: ${JSON.stringify(thread)}\n\n`);
    });
    streams.add(raw);
    const cleanup = () => {
      unsubscribe();
      streams.delete(raw);
    };
    request.raw.on("close", cleanup);
    raw.on("close", cleanup);
  });
  // Open SSE responses would otherwise hold app.close() open forever.
  app.addHook("preClose", async () => {
    for (const raw of streams) raw.end();
    streams.clear();
  });

  app.get<{ Params: { id: string } }>("/api/threads/:id", async (request, reply) => {
    const thread = getThread(db, request.params.id);
    if (!thread) return reply.code(404).send({ error: "thread not found" });
    return thread;
  });

  app.post<{ Body: CreateThreadBody }>("/api/threads", async (request, reply) => {
    const { itemType, itemId, anchor, author, body } = request.body ?? {};
    if (!validateItemType(itemType)) {
      return reply.code(400).send({ error: "itemType is required: lowercase letters, digits, '-' or '_'" });
    }
    if (!nonEmpty(itemId)) return reply.code(400).send({ error: "itemId is required" });
    if (!nonEmpty(body)) return reply.code(400).send({ error: "body is required" });
    const badAnchor = anchorError(anchor);
    if (badAnchor) return reply.code(400).send({ error: badAnchor });

    const { threadId, messageId } = createThread(db, {
      itemType,
      itemId,
      anchor: anchor ?? null,
      author: nonEmpty(author) ? author.trim() : DEFAULT_OPERATOR,
      body: body.trim(),
    });
    const thread = await sendOut(request, threadId, messageId);
    return reply.code(201).send(thread);
  });

  app.post<{ Params: { id: string }; Body: { author?: string; body?: string } }>(
    "/api/threads/:id/messages",
    async (request, reply) => {
      const { id } = request.params;
      const { author, body } = request.body ?? {};
      if (!getThread(db, id)) return reply.code(404).send({ error: "thread not found" });
      if (!nonEmpty(body)) return reply.code(400).send({ error: "body is required" });
      const messageId = addMessage(db, id, {
        role: "operator",
        author: nonEmpty(author) ? author.trim() : DEFAULT_OPERATOR,
        body: body.trim(),
      });
      const thread = await sendOut(request, id, messageId);
      return reply.code(201).send(thread);
    },
  );

  app.post<{ Params: { id: string }; Body: ReplyBody }>("/api/threads/:id/replies", async (request, reply) => {
    const { id } = request.params;
    const { author, body, proposalId, proposalUrl } = request.body ?? {};
    if (!getThread(db, id)) return reply.code(404).send({ error: "thread not found" });
    if (!nonEmpty(author)) return reply.code(400).send({ error: "author is required" });
    if (!nonEmpty(body)) return reply.code(400).send({ error: "body is required" });
    if (proposalId !== undefined && proposalId !== null && !nonEmpty(proposalId)) {
      return reply.code(400).send({ error: "proposalId must be a non-empty string" });
    }
    if (proposalUrl !== undefined && proposalUrl !== null && !(nonEmpty(proposalUrl) && URL.canParse(proposalUrl))) {
      return reply.code(400).send({ error: "proposalUrl must be an absolute URL" });
    }
    addMessage(db, id, {
      role: "agent",
      author: author.trim(),
      body: body.trim(),
      proposalId: proposalId ?? null,
      proposalUrl: proposalUrl ?? null,
    });
    return reply.code(201).send(publish(id));
  });

  // Manual retry when the latest operator message never reached an agent.
  app.post<{ Params: { id: string } }>("/api/threads/:id/redeliver", async (request, reply) => {
    const { id } = request.params;
    const thread = getThread(db, id);
    if (!thread) return reply.code(404).send({ error: "thread not found" });
    const failed = lastFailedOperatorMessage(thread);
    if (!failed) return reply.code(409).send({ error: "nothing to redeliver" });
    return sendOut(request, id, failed.id);
  });
}
