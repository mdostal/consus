import { AnswerControl } from "./answer-shapes/AnswerControl";
import type { DecisionPayload } from "./answer-shapes/types";
import "../../theme/tokens.css";

export interface DecisionCardProps {
  question: string;
  recommendation?: string;
  payload: DecisionPayload;
  status?: string;
  sourceDoc?: string;
  onAnswer: (answer: string) => void;
}

/**
 * The shared rendering primitive (REQ-15): a question + a recommendation +
 * an answer slot (the go/no-go pattern), theme-aware, with status pills and
 * a collapsible source doc. Every other item view (docs, KB entries,
 * Minerva human_requests) composes on top of this instead of inventing its
 * own presentation.
 */
export function DecisionCard({ question, recommendation, payload, status, sourceDoc, onAnswer }: DecisionCardProps) {
  return (
    <article className="decision-card">
      {status ? (
        <span data-testid="status-pill" className="decision-card__pill">
          {status}
        </span>
      ) : null}

      <h2 className="decision-card__question">{question}</h2>

      {recommendation ? <p className="decision-card__recommendation">{recommendation}</p> : null}

      <div className="decision-card__answer-slot">
        <AnswerControl payload={payload} onAnswer={onAnswer} />
      </div>

      {sourceDoc ? (
        <details data-testid="source-doc" className="decision-card__source">
          <summary>Source</summary>
          <div className="decision-card__source-content">{sourceDoc}</div>
        </details>
      ) : null}
    </article>
  );
}
