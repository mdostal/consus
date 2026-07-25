import { DecisionCard } from "../decisions/DecisionCard";
import type { DecisionPayload, Verdict } from "../decisions/answer-shapes/types";

export interface QueuedQuestion {
  minervaQuestionId: string;
  text: string;
  ticketId: string | null;
  decisionPayload: DecisionPayload;
}

export interface QAQueueProps {
  questions: QueuedQuestion[];
  onAnswer: (minervaQuestionId: string, verdict: Verdict) => void;
}

/**
 * REQ-02: the biggest v1 priority — a queue of open Minerva questions,
 * answerable async, linked to their originating ticket where available.
 * Each item renders through the shared DecisionCard (decision-card-
 * renderer-ui) rather than a bespoke queue-item UI, since
 * minerva-adapter-bridge already populates a decision_payload per Question.
 */
export function QAQueue({ questions, onAnswer }: QAQueueProps) {
  return (
    <div className="qa-queue">
      {questions.map((q) => (
        <div key={q.minervaQuestionId} className="qa-queue__item">
          {q.ticketId ? <span className="qa-queue__ticket">{q.ticketId}</span> : null}
          <DecisionCard
            question={q.text}
            payload={q.decisionPayload}
            onVerdict={(verdict) => onAnswer(q.minervaQuestionId, verdict)}
          />
        </div>
      ))}
    </div>
  );
}
