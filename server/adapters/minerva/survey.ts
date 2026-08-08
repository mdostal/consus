import type Database from "better-sqlite3";
import { ingestQuestion, type Question } from "./index.js";
import type { MinervaTransport } from "./transport.js";

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
  answer: string | null;
  status: string;
  survey_id: number;
}

export interface AnswerSurveyInput {
  minervaSurveyId: string;
  actor: string;
  answers: Array<{
    minervaQuestionId: string;
    answer: string;
  }>;
}

export function itemIdForSurvey(minervaSurveyId: string): string {
  return `survey:${minervaSurveyId}`;
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
      `INSERT INTO items (id, type, title, status, created_at, updated_at)
       VALUES (?, ?, ?, 'open', ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
    ).run(itemIdForSurvey(minervaSurveyId), "survey", title, now, now);

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

/**
 * Submit one operator survey batch as one state transition. Individual answers
 * are still stored on their human_request rows, but the audit trail records a
 * single submit-level summary instead of one near-identical row per question.
 * Re-submitting the same answer values is a no-op to avoid append-only noise.
 */
export async function answerSurvey(
  db: Database.Database,
  transport: MinervaTransport,
  { minervaSurveyId, actor, answers }: AnswerSurveyInput,
): Promise<void> {
  if (answers.length === 0) return;

  const survey = db
    .prepare("SELECT id, status, title FROM surveys WHERE minerva_survey_id = ?")
    .get(minervaSurveyId) as { id: number; status: "open" | "answered"; title: string } | undefined;
  if (!survey) {
    throw new Error(`survey not found: ${minervaSurveyId}`);
  }

  const rows = getSurveyQuestions(db, minervaSurveyId);
  const rowsByQuestionId = new Map(rows.map((row) => [row.minerva_question_id, row]));
  for (const { minervaQuestionId } of answers) {
    if (!rowsByQuestionId.has(minervaQuestionId)) {
      throw new Error(`question ${minervaQuestionId} does not belong to survey: ${minervaSurveyId}`);
    }
  }

  const changedAnswers = answers.filter(({ minervaQuestionId, answer }) => {
    const row = rowsByQuestionId.get(minervaQuestionId);
    return row?.status !== "answered" || row.answer !== answer;
  });
  if (changedAnswers.length === 0) return;

  const before = getSurveyProgress(db, minervaSurveyId);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    for (const { minervaQuestionId, answer } of changedAnswers) {
      const row = rowsByQuestionId.get(minervaQuestionId);
      if (!row) {
        throw new Error(`question ${minervaQuestionId} does not belong to survey: ${minervaSurveyId}`);
      }
      db.prepare("UPDATE human_requests SET status = 'answered', answer = ? WHERE minerva_question_id = ?").run(
        answer,
        minervaQuestionId,
      );
      db.prepare("UPDATE items SET status = 'answered', updated_at = ? WHERE id = ?").run(now, row.item_id);
    }

    const siblings = db
      .prepare("SELECT status FROM human_requests WHERE survey_id = ?")
      .all(survey.id) as Array<{ status: string }>;
    const surveyStatus = siblings.every((s) => s.status === "answered") ? "answered" : "open";
    db.prepare("UPDATE surveys SET status = ? WHERE id = ?").run(surveyStatus, survey.id);
    db.prepare("UPDATE items SET status = ?, updated_at = ? WHERE id = ?").run(
      surveyStatus,
      now,
      itemIdForSurvey(minervaSurveyId),
    );

    const answered = siblings.filter((s) => s.status === "answered").length;
    db.prepare(
      "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      itemIdForSurvey(minervaSurveyId),
      actor,
      "survey_submit",
      `${before.answered}/${before.total} answered (${before.status})`,
      `${answered}/${siblings.length} answered (${surveyStatus}); ${changedAnswers.length} answer(s) changed`,
      now,
    );
  });
  tx();

  for (const { minervaQuestionId, answer } of changedAnswers) {
    const result = await transport.invoke("answerQuestion", { id: minervaQuestionId, answer });
    if (!result.ok && !result.recoverable) {
      // eslint-disable-next-line no-console
      console.error(`[minerva-adapter] status write-back failed for ${minervaQuestionId}: ${result.code}`);
    }
  }
}
