import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { ingestSurvey, getSurveyProgress, getSurveyQuestions } from "./survey.js";
import { answerHumanRequest } from "./index.js";
import type { MinervaTransport } from "./transport.js";

function fakeTransport(): MinervaTransport {
  return {
    async invoke() {
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
});
