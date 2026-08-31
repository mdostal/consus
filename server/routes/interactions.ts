import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export interface InteractionRoutesOptions {
  db: Database.Database;
  /** Pantheon core-api base URL. When set (or PANTHEON_API_URL env var is set), a real
   *  verdict fires a fire-and-forget POST to /api/events/decisions on the host. */
  pantheonApiUrl?: string;
  /** Override the fetch implementation — used in tests to capture bridge calls. */
  fetch?: typeof globalThis.fetch;
}

type Verdict =
  | { kind: "accepted" }
  | { kind: "option_chosen"; optionId: string }
  | { kind: "mix"; optionIds: string[]; why: string }
  | { kind: "rejected_iteration_requested"; commentary: string };

function verdictStatus(v: Verdict): "done" | "in_progress" {
  return v.kind === "rejected_iteration_requested" ? "in_progress" : "done";
}

function verdictSummary(v: Verdict): string {
  switch (v.kind) {
    case "accepted":
      return "Accepted the recommended option.";
    case "option_chosen":
      return `Chose option ${v.optionId}.`;
    case "mix":
      return `Mixed options ${v.optionIds.join(" + ")} — ${v.why}`;
    case "rejected_iteration_requested":
      return `Requested another round — ${v.commentary}`;
  }
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

      const now = new Date().toISOString();
      const nextStatus = verdictStatus(verdict);
      // Reject → reopen (clear decided_at); accept/choose/mix → decide.
      const decidedAt = verdict.kind === "rejected_iteration_requested" ? null : now;

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
      });
      tx();

      // Fire-and-forget bridge: non-rejection verdicts become board seeds in Multica via Pantheon.
      // Verdict recording always succeeds regardless of bridge health (same resilience contract as
      // core-api's emitDecisionCreated).
      if (decidedAt !== null) {
        const bridgeBase = pantheonApiUrl ?? process.env.PANTHEON_API_URL;
        if (bridgeBase) {
          const doFetch = fetchImpl ?? globalThis.fetch;
          doFetch(`${bridgeBase}/api/events/decisions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              decisionId: id,
              title: item.title,
              ...(item.source_body ? { summary: item.source_body } : {}),
              createdAt: now,
            }),
          }).catch((err: unknown) => {
            console.error("[interactions] decision bridge call failed", err);
          });
        }
      }

      return reply.code(200).send({ ok: true, status: nextStatus, decided_at: decidedAt });
    },
  );
}
