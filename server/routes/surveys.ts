import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface SurveyRoutesOptions {
  db: Database.Database;
}

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
}

interface SurveyMemberRow {
  id: string;
  title: string;
  status: string;
  decided_at: string | null;
}

interface CreateSurveyBody {
  title?: string;
  description?: string;
  decision_ids?: string[];
}

export function registerSurveyRoutes(app: FastifyInstance, { db }: SurveyRoutesOptions): void {
  /**
   * POST /api/surveys — create a named survey container.
   * Optional `decision_ids` assigns pre-existing decision items to this survey.
   * Unknown ids are silently skipped (items must exist and carry a
   * decision_payload; a non-existent id is a no-op, not a 404, to keep the
   * caller's side-effect-free create + assign pattern simple).
   */
  app.post<{ Body: CreateSurveyBody }>("/api/surveys", async (request, reply) => {
    const { title, description, decision_ids } = request.body ?? {};

    if (!title) {
      return reply.code(400).send({ error: "title is required" });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare("INSERT INTO surveys (id, title, description, created_at) VALUES (?, ?, ?, ?)").run(
      id,
      title,
      description ?? null,
      now,
    );

    if (Array.isArray(decision_ids) && decision_ids.length > 0) {
      const update = db.prepare(
        "UPDATE items SET survey_id = ? WHERE id = ? AND decision_payload IS NOT NULL",
      );
      for (const decisionId of decision_ids) {
        update.run(id, decisionId);
      }
    }

    const survey = db.prepare("SELECT id, title, description, created_at FROM surveys WHERE id = ?").get(id) as SurveyRow;
    const members = db
      .prepare("SELECT id, title, status, decided_at FROM items WHERE survey_id = ? ORDER BY created_at ASC")
      .all(id) as SurveyMemberRow[];

    return reply.code(201).send({ ...survey, members });
  });

  /**
   * GET /api/surveys/:id — return the survey and its member decisions.
   */
  app.get<{ Params: { id: string } }>("/api/surveys/:id", async (request, reply) => {
    const survey = db
      .prepare("SELECT id, title, description, created_at FROM surveys WHERE id = ?")
      .get(request.params.id) as SurveyRow | undefined;

    if (!survey) {
      return reply.code(404).send({ error: "survey not found" });
    }

    const members = db
      .prepare("SELECT id, title, status, decided_at FROM items WHERE survey_id = ? ORDER BY created_at ASC")
      .all(survey.id) as SurveyMemberRow[];

    return { ...survey, members };
  });
}
