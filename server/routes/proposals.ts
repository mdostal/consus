import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { MinervaTransport } from "../adapters/minerva/transport.js";
import { proposeChange, reportProposalResult, listProposals } from "../proposals/store.js";

export interface ProposalRoutesOptions {
  db: Database.Database;
  transport: MinervaTransport;
}

interface CreateProposalBody {
  itemId?: string;
  targetType?: string;
  diff?: string;
  description?: string;
  requestedBy?: string;
}

interface ReportResultBody {
  status?: "applied" | "failed";
  appliedDiff?: string;
  reason?: string;
}

/**
 * The propose-a-change-and-fire-to-harness surface (s3). One route family
 * shared by decisions, diagrams, and docs — no target-type branching here.
 */
export function registerProposalRoutes(app: FastifyInstance, { db, transport }: ProposalRoutesOptions): void {
  app.post<{ Body: CreateProposalBody }>("/api/proposals", async (request, reply) => {
    const { itemId, targetType, diff, description, requestedBy } = request.body ?? {};
    if (!itemId || !targetType || !diff || !description || !requestedBy) {
      return reply.code(400).send({
        error: "itemId, targetType, diff, description, and requestedBy are all required",
      });
    }

    const result = await proposeChange(db, transport, { itemId, targetType, diff, description, requestedBy });
    if (!result.ok) {
      return reply.code(404).send({ error: result.error });
    }

    const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(result.proposalId);
    return reply.code(201).send(row);
  });

  app.post<{ Params: { id: string }; Body: ReportResultBody }>(
    "/api/proposals/:id/result",
    async (request, reply) => {
      const { id } = request.params;
      const { status, appliedDiff, reason } = request.body ?? {};
      if (status !== "applied" && status !== "failed") {
        return reply.code(400).send({ error: "status must be 'applied' or 'failed'" });
      }

      const result = await reportProposalResult(db, { proposalId: id, status, appliedDiff, reason });
      if (!result.ok) {
        return reply.code(404).send({ error: result.error });
      }

      const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(id);
      return row;
    },
  );

  app.get<{ Querystring: { itemId?: string } }>("/api/proposals", async (request, reply) => {
    const { itemId } = request.query;
    if (!itemId) {
      return reply.code(400).send({ error: "itemId query param is required" });
    }
    return listProposals(db, itemId);
  });
}
