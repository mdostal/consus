import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  closeQuestionTicket,
  importQuestionTicket,
  type QuestionItem,
} from "../questions/import.js";

export interface QuestionRoutesOptions {
  db: Database.Database;
}

interface ImportBody {
  ticket_id?: unknown;
  identifier?: unknown;
  questions?: unknown;
}

interface CloseBody {
  reason?: unknown;
  actor?: unknown;
}

function isQuestionItem(q: unknown): q is QuestionItem {
  if (!q || typeof q !== "object") return false;
  const { qid, text, kind, options } = q as Record<string, unknown>;
  return (
    typeof qid === "string" &&
    typeof text === "string" &&
    typeof kind === "string" &&
    (options === undefined || (Array.isArray(options) && options.every((o) => typeof o === "string")))
  );
}

/**
 * The generic question seam. An external system pushes a question ticket in,
 * or tells Consus the ticket was cancelled/answered elsewhere, over plain
 * REST. Consus never polls for questions.
 */
export function registerQuestionRoutes(app: FastifyInstance, { db }: QuestionRoutesOptions): void {
  app.post<{ Body: ImportBody }>("/api/questions/import", async (request, reply) => {
    const { ticket_id, identifier, questions } = request.body ?? {};

    if (typeof ticket_id !== "string" || !ticket_id) {
      return reply.code(400).send({ error: "ticket_id is required" });
    }
    if (identifier !== undefined && identifier !== null && typeof identifier !== "string") {
      return reply.code(400).send({ error: "identifier must be a string" });
    }
    if (!Array.isArray(questions) || !questions.every(isQuestionItem)) {
      return reply.code(400).send({ error: "questions must be an array of { qid, text, kind, options? }" });
    }

    const result = importQuestionTicket(db, { ticket_id, identifier: identifier ?? null, questions });
    switch (result.status) {
      case "created":
        return reply.code(201).send({ ticket_id, survey_id: result.surveyId, item_ids: result.itemIds });
      case "exists":
        return reply.code(200).send({ ticket_id, survey_id: result.surveyId });
      case "unmappable":
        return reply.code(422).send({ error: "no question in this ticket maps to a decision shape" });
    }
  });

  app.post<{ Params: { ticket: string }; Body: CloseBody }>(
    "/api/questions/:ticket/close",
    async (request, reply) => {
      const { ticket } = request.params;
      const { reason, actor } = request.body ?? {};

      if (typeof reason !== "string" || !reason.trim()) {
        return reply.code(400).send({ error: "reason is required" });
      }
      if (actor !== undefined && (typeof actor !== "string" || !actor)) {
        return reply.code(400).send({ error: "actor must be a non-empty string" });
      }

      const result = closeQuestionTicket(db, ticket, reason.trim(), actor);
      if (!result.found) return reply.code(404).send({ error: "no survey is linked to this ticket" });

      return reply.code(200).send({
        ticket_id: ticket,
        survey_id: result.surveyId,
        closed_item_ids: result.closedItemIds,
      });
    },
  );
}
