import type Database from "better-sqlite3";
import { ingestQuestion, type Question } from "./index.js";

export interface IngestSurveyInput {
  minervaSurveyId: string;
  title: string;
  questions: Question[];
}

export interface SurveyProgress {
  answered: number;
  total: number;
  status: "open" | "answered";
}

export interface SurveyQuestionRow {
  id: number;
  item_id: string;
  minerva_question_id: string;
  status: string;
  survey_id: number;
}

/**
 * REQ-26: ingest a batch of N related Minerva questions as one survey.
 * Each sub-question is stored via the existing single-question
 * ingestQuestion() (unchanged behavior — its own decision_payload, its own
 * item row); this function only adds the grouping layer: a surveys row plus
 * a survey_id FK on each resulting human_requests row.
 */
export function ingestSurvey(db: Database.Database, { minervaSurveyId, title, questions }: IngestSurveyInput): void {
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO surveys (minerva_survey_id, title, status, created_at) VALUES (?, ?, 'open', ?)
       ON CONFLICT(minerva_survey_id) DO NOTHING`,
    ).run(minervaSurveyId, title, now);

    const survey = db
      .prepare("SELECT id FROM surveys WHERE minerva_survey_id = ?")
      .get(minervaSurveyId) as { id: number };

    for (const question of questions) {
      ingestQuestion(db, question);
      db.prepare("UPDATE human_requests SET survey_id = ? WHERE minerva_question_id = ?").run(
        survey.id,
        question.id,
      );
    }
  });
  tx();
}

export function getSurveyQuestions(db: Database.Database, minervaSurveyId: string): SurveyQuestionRow[] {
  return db
    .prepare(
      `SELECT hr.* FROM human_requests hr
       JOIN surveys s ON s.id = hr.survey_id
       WHERE s.minerva_survey_id = ?
       ORDER BY hr.id ASC`,
    )
    .all(minervaSurveyId) as SurveyQuestionRow[];
}

export function getSurveyProgress(db: Database.Database, minervaSurveyId: string): SurveyProgress {
  const survey = db
    .prepare("SELECT status FROM surveys WHERE minerva_survey_id = ?")
    .get(minervaSurveyId) as { status: "open" | "answered" } | undefined;
  if (!survey) {
    throw new Error(`survey not found: ${minervaSurveyId}`);
  }

  const questions = getSurveyQuestions(db, minervaSurveyId);
  const answered = questions.filter((q) => q.status === "answered").length;

  return { answered, total: questions.length, status: survey.status };
}
