import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { answerSurvey, ingestSurvey, getSurveyProgress, getSurveyQuestions, itemIdForSurvey } from "./survey.js";
import { answerHumanRequest } from "./index.js";
import type { MinervaTransport } from "./transport.js";

function fakeTransport(): MinervaTransport & { calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    async invoke(method, params) {
      calls.push({ method, params });
      return { ok: true, result: {} };
    },
  };
}

describe("Survey Manager", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("ingests a batch of N related questions, each carrying its own decision_payload, linked to one survey", () => {
    ingestSurvey(db, {
      minervaSurveyId: "survey-1",
      title: "Client hub feature survey",
      questions: [
        { id: "q-1", text: "Include dark mode?", channel: "features", reason: null, status: "open" },
        { id: "q-2", text: "Include export-to-PDF?", channel: "features", reason: null, status: "open" },
      ],
    });

    const questions = getSurveyQuestions(db, "survey-1");
    expect(questions).toHaveLength(2);
    for (const q of questions) {
      const item = db.prepare("SELECT decision_payload FROM items WHERE id = ?").get(q.item_id) as
        | { decision_payload: string | null }
        | undefined;
      expect(item?.decision_payload).toBeTruthy();
      expect(q.survey_id).toBeTruthy();
    }
  });

  it("reports accurate partial progress", () => {
    ingestSurvey(db, {
      minervaSurveyId: "survey-2",
      title: "Survey",
      questions: [
        { id: "q-3", text: "Q3", channel: "general", reason: null, status: "open" },
        { id: "q-4", text: "Q4", channel: "general", reason: null, status: "open" },
        { id: "q-5", text: "Q5", channel: "general", reason: null, status: "open" },
      ],
    });

    expect(getSurveyProgress(db, "survey-2")).toEqual({ answered: 0, total: 3, status: "open" });
  });

  it("transitions the survey to 'answered' once every sub-question is answered", async () => {
    ingestSurvey(db, {
      minervaSurveyId: "survey-3",
      title: "Survey",
      questions: [
        { id: "q-6", text: "Q6", channel: "general", reason: null, status: "open" },
        { id: "q-7", text: "Q7", channel: "general", reason: null, status: "open" },
      ],
    });
    const transport = fakeTransport();

    await answerHumanRequest(db, transport, { minervaQuestionId: "q-6", answer: "yes" });
    expect(getSurveyProgress(db, "survey-3")).toEqual({ answered: 1, total: 2, status: "open" });

    await answerHumanRequest(db, transport, { minervaQuestionId: "q-7", answer: "no" });
    expect(getSurveyProgress(db, "survey-3")).toEqual({ answered: 2, total: 2, status: "answered" });
  });

  it("retrieves a survey's sub-questions as a group by survey_id", () => {
    ingestSurvey(db, {
      minervaSurveyId: "survey-4",
      title: "Survey",
      questions: [
        { id: "q-8", text: "Q8", channel: "general", reason: null, status: "open" },
        { id: "q-9", text: "Q9", channel: "general", reason: null, status: "open" },
      ],
    });

    const questions = getSurveyQuestions(db, "survey-4");
    expect(questions.map((q) => q.minerva_question_id).sort()).toEqual(["q-8", "q-9"]);
  });

  it("stores a survey as an item so submit-level audit has one stable target", () => {
    ingestSurvey(db, {
      minervaSurveyId: "survey-5",
      title: "Survey item",
      questions: [{ id: "q-10", text: "Q10", channel: "general", reason: null, status: "open" }],
    });

    const row = db.prepare("SELECT type, title, status FROM items WHERE id = ?").get(itemIdForSurvey("survey-5"));
    expect(row).toMatchObject({ type: "survey", title: "Survey item", status: "open" });
  });

  it("answers a multi-question survey with one summary audit row, not one row per question", async () => {
    ingestSurvey(db, {
      minervaSurveyId: "survey-6",
      title: "Survey batch",
      questions: [
        { id: "q-11", text: "Q11", channel: "general", reason: null, status: "open" },
        { id: "q-12", text: "Q12", channel: "general", reason: null, status: "open" },
        { id: "q-13", text: "Q13", channel: "general", reason: null, status: "open" },
      ],
    });
    const transport = fakeTransport();

    await answerSurvey(db, transport, {
      minervaSurveyId: "survey-6",
      actor: "mathew",
      answers: [
        { minervaQuestionId: "q-11", answer: "yes" },
        { minervaQuestionId: "q-12", answer: "no" },
        { minervaQuestionId: "q-13", answer: "maybe" },
      ],
    });

    expect(getSurveyProgress(db, "survey-6")).toEqual({ answered: 3, total: 3, status: "answered" });
    expect(transport.calls).toHaveLength(3);
    const auditRows = db.prepare("SELECT * FROM audit_log WHERE item_id = ?").all(itemIdForSurvey("survey-6")) as
      Array<{ field: string; old_value: string | null; new_value: string | null }>;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      field: "survey_submit",
      old_value: "0/3 answered (open)",
      new_value: "3/3 answered (answered); 3 answer(s) changed",
    });

    const answers = db
      .prepare("SELECT minerva_question_id, answer FROM human_requests WHERE survey_id IS NOT NULL ORDER BY minerva_question_id")
      .all();
    expect(answers).toEqual([
      { minerva_question_id: "q-11", answer: "yes" },
      { minerva_question_id: "q-12", answer: "no" },
      { minerva_question_id: "q-13", answer: "maybe" },
    ]);
  });

  it("deduplicates identical repeat survey submits without appending audit noise", async () => {
    ingestSurvey(db, {
      minervaSurveyId: "survey-7",
      title: "Survey repeat",
      questions: [
        { id: "q-14", text: "Q14", channel: "general", reason: null, status: "open" },
        { id: "q-15", text: "Q15", channel: "general", reason: null, status: "open" },
      ],
    });
    const transport = fakeTransport();
    const submit = {
      minervaSurveyId: "survey-7",
      actor: "mathew",
      answers: [
        { minervaQuestionId: "q-14", answer: "yes" },
        { minervaQuestionId: "q-15", answer: "no" },
      ],
    };

    await answerSurvey(db, transport, submit);
    await answerSurvey(db, transport, submit);

    const auditRows = db.prepare("SELECT * FROM audit_log WHERE item_id = ?").all(itemIdForSurvey("survey-7"));
    expect(auditRows).toHaveLength(1);
    expect(transport.calls).toHaveLength(2);
  });
});
