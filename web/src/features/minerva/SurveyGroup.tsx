import { DecisionCard } from "../decisions/DecisionCard";
import type { DecisionPayload, Verdict } from "../decisions/answer-shapes/types";

export interface SurveyQuestion {
  minervaQuestionId: string;
  text: string;
  status: string;
  decisionPayload: DecisionPayload;
}

export interface SurveyProgress {
  answered: number;
  total: number;
  status: "open" | "answered";
}

export interface Survey {
  title: string;
  progress: SurveyProgress;
  questions: SurveyQuestion[];
}

export interface SurveyGroupProps {
  survey: Survey;
  onAnswer: (minervaQuestionId: string, verdict: Verdict) => void;
}

/**
 * REQ-26 frontend: a survey's N sub-questions grouped together with visible
 * batch-completion progress. Each sub-question still renders through the
 * shared DecisionCard — no bespoke per-survey answer UI.
 */
export function SurveyGroup({ survey, onAnswer }: SurveyGroupProps) {
  return (
    <section className="survey-group">
      <header className="survey-group__header">
        <h2>{survey.title}</h2>
        <span className="survey-group__progress">
          {survey.progress.answered} of {survey.progress.total} answered
        </span>
      </header>

      <div className="survey-group__questions">
        {survey.questions.map((q) => (
          <DecisionCard
            key={q.minervaQuestionId}
            question={q.text}
            payload={q.decisionPayload}
            onVerdict={(verdict) => onAnswer(q.minervaQuestionId, verdict)}
          />
        ))}
      </div>
    </section>
  );
}
