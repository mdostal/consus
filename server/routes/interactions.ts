import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { verdictStatus, verdictSummary } from "../decision-contract/parser.js";
import type { Verdict } from "../decision-contract/parser.js";
import {
  deliverQuestionDeliveries,
  enqueueQuestionVerdict,
  getQuestionLink,
  questionAnswerFor,
  redeliverQuestionDeliveries,
} from "../pantheon/answer-delivery.js";
import { recordSyncFailure, recordSyncSuccess, safeRecord } from "../pantheon/sync-status.js";
import { markInboxSeen } from "../inbox/query.js";

export interface InteractionRoutesOptions {
  db: Database.Database;
  /** Pantheon core-api base URL. When set (or PANTHEON_API_URL env var is set), a real
   *  verdict fires a fire-and-forget POST to /api/events/decisions on the host. */
  pantheonApiUrl?: string;
  /** Override the fetch implementation — used in tests to capture bridge calls. */
  fetch?: typeof globalThis.fetch;
}

/**
 * The write side of the decision surface (companion to the read-only
 * /api/decisions and /api/items/:id/artifact-links routes): record a human
 * verdict on a decision, and read/post the comment thread on any item. All
 * additive — uses the existing items / audit_log / comments tables only.
 */
export function registerInteractionRoutes(
  app: FastifyInstance,
  { db, pantheonApiUrl, fetch: fetchImpl }: InteractionRoutesOptions,
): void {
  // Comment thread for any item.
  app.get<{ Params: { id: string } }>("/api/items/:id/comments", async (request) => {
    const { id } = request.params;
    const rows = db
      .prepare("SELECT id, author, body, created_at AS createdAt FROM comments WHERE item_id = ? ORDER BY id ASC")
      .all(id);
    return rows;
  });

  app.post<{ Params: { id: string }; Body: { author?: string; body: string } }>(
    "/api/items/:id/comments",
    async (request, reply) => {
      const { id } = request.params;
      const { author, body } = request.body ?? ({} as { author?: string; body: string });
      if (!body || !body.trim()) return reply.code(400).send({ error: "body required" });
      const now = new Date().toISOString();
      const info = db
        .prepare("INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)")
        .run(id, author ?? "Mathew", body.trim(), now);
      // PANT-960: writing in a thread means it has been read — the operator's
      // own comment must not show up as a new reply in the inbox.
      markInboxSeen(db, id, now);
      return reply.code(201).send({ id: info.lastInsertRowid, author: author ?? "Mathew", body: body.trim(), createdAt: now });
    },
  );

  // Record a verdict on a decision item.
  app.post<{ Params: { id: string }; Body: { verdict: Verdict; actor?: string } }>(
    "/api/decisions/:id/verdict",
    async (request, reply) => {
      const { id } = request.params;
      const { verdict, actor } = request.body ?? ({} as { verdict: Verdict; actor?: string });
      if (!verdict || !verdict.kind) return reply.code(400).send({ error: "verdict required" });

      const item = db
        .prepare("SELECT id, title, status, source_body, created_at AS createdAt FROM items WHERE id = ?")
        .get(id) as { id: string; title: string; status: string; source_body: string | null; createdAt: string } | undefined;
      if (!item) return reply.code(404).send({ error: "decision not found" });
      // Closed via POST /api/questions/:ticket/close — the upstream ticket is
      // gone, so there is nothing left to answer.
      if (item.status === "closed") return reply.code(409).send({ error: "decision is closed" });

      const now = new Date().toISOString();
      const nextStatus = verdictStatus(verdict);
      // Reject → reopen (clear decided_at); accept/choose/mix → decide.
      const decidedAt = verdict.kind === "rejected_iteration_requested" ? null : now;

      // A question-linked item's answer goes back to Pantheon, so a verdict
      // with no meaningful answer for its payload (e.g. `accepted` on a
      // free-text question) is refused rather than recorded.
      const questionLink = getQuestionLink(db, id);
      if (questionLink && decidedAt !== null && questionAnswerFor(db, id, verdict) === null) {
        return reply.code(400).send({ error: `verdict "${verdict.kind}" has no answer for this question` });
      }
      const bridgeBase = pantheonApiUrl ?? process.env.PANTHEON_API_URL;
      const doFetch = fetchImpl ?? globalThis.fetch;
      let deliveryIds: number[] = [];

      const tx = db.transaction(() => {
        db.prepare("UPDATE items SET status = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(
          nextStatus,
          decidedAt,
          now,
          id,
        );
        db.prepare(
          "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, actor ?? "Mathew", "verdict", item.status, JSON.stringify(verdict), now);
        db.prepare("INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)").run(
          id,
          actor ?? "Mathew",
          `Decision recorded: ${verdictSummary(verdict)}`,
          now,
        );
        markInboxSeen(db, id, now);
        // Question answers are written to the delivery outbox in the same
        // transaction as the verdict, so a failed POST is retried, never lost.
        if (questionLink && decidedAt !== null && bridgeBase) {
          deliveryIds = enqueueQuestionVerdict(db, id, verdict, actor ?? "Mathew");
        }
      });
      tx();

      // Route question-linked items to the Pantheon question adapter (partial + submit);
      // unlinked decisions keep the existing /api/events/decisions seed path.
      // Neither delays the response: verdict recording always succeeds regardless of bridge health.
      if (decidedAt !== null) {
        if (bridgeBase) {
          if (questionLink) {
            deliverQuestionDeliveries(db, deliveryIds, { pantheonApiUrl: bridgeBase, fetch: doFetch }).catch(
              (err: unknown) => {
                console.error("[interactions] question delivery failed", err);
              },
            );
          } else {
            doFetch(`${bridgeBase}/api/events/decisions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                decisionId: id,
                title: item.title,
                ...(item.source_body ? { summary: item.source_body } : {}),
                createdAt: now,
              }),
            })
              .then((res) => {
                safeRecord(() =>
                  res.ok
                    ? recordSyncSuccess(db, "decision_push")
                    : recordSyncFailure(db, "decision_push", `Pantheon decision bridge failed: ${res.status}`),
                );
              })
              .catch((err: unknown) => {
                console.error("[interactions] decision bridge call failed", err);
                safeRecord(() => recordSyncFailure(db, "decision_push", err));
              });
          }
        }
      }

      return reply.code(200).send({ ok: true, status: nextStatus, decided_at: decidedAt });
    },
  );

  // Retry every pending/failed question answer in the delivery outbox.
  app.post("/api/questions/redeliver", async (_request, reply) => {
    const bridgeBase = pantheonApiUrl ?? process.env.PANTHEON_API_URL;
    if (!bridgeBase) return reply.code(409).send({ error: "PANTHEON_API_URL is not configured" });
    const result = await redeliverQuestionDeliveries(db, {
      pantheonApiUrl: bridgeBase,
      fetch: fetchImpl ?? globalThis.fetch,
    });
    const { remaining } = db
      .prepare("SELECT COUNT(*) AS remaining FROM question_deliveries WHERE status != 'delivered'")
      .get() as { remaining: number };
    return reply.code(200).send({ ...result, remaining });
  });
}
