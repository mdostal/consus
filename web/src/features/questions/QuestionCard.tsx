import { useState } from "react";
import { submitAnswer, type Question } from "../../api/questions";

const ACTOR = "operator";

export interface QuestionCardProps {
  question: Question;
  onAnswered: (id: string) => void;
}

type SubmitState = { status: "idle" } | { status: "submitting" } | { status: "error"; message: string };

/**
 * A single pending question with an answer textarea. Submitting POSTs to
 * /api/questions/:id/answer (PAN-8233); on success the parent (QuestionInbox)
 * removes it from the list. On failure the draft answer is kept in the
 * textarea and an error message is shown, so nothing typed is lost.
 */
export function QuestionCard({ question, onAnswered }: QuestionCardProps) {
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function handleSubmit() {
    const trimmed = answer.trim();
    if (!trimmed) return;

    setState({ status: "submitting" });
    try {
      await submitAnswer(question.id, { answer: trimmed, actor: ACTOR });
      onAnswered(question.id);
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to submit answer.",
      });
    }
  }

  const submitting = state.status === "submitting";

  return (
    <article className="question-card" data-testid="question-card">
      <span className="question-card__agent">{question.agent_name}</span>
      <time className="question-card__time" dateTime={question.created_at}>
        {question.created_at}
      </time>
      <p className="question-card__text">{question.text}</p>

      {state.status === "error" ? (
        <p role="alert" className="question-card__error">
          {state.message}
        </p>
      ) : null}

      <div className="question-card__answer">
        <textarea
          aria-label={`Answer for ${question.text}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={submitting}
        />
        <button type="button" disabled={submitting || !answer.trim()} onClick={handleSubmit}>
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </article>
  );
}
