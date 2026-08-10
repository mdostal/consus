import { useEffect, useState } from "react";
import { fetchQuestions, type Question } from "../../api/questions";
import { QuestionCard } from "./QuestionCard";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: Question[] };

/**
 * [frontend-api-integration]: fetches the pending question queue on mount
 * from GET /api/questions and renders a QuestionCard per question. A card
 * removes itself from the list once its answer is accepted by the API.
 */
export function QuestionInbox() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetchQuestions()
      .then((items) => {
        if (!cancelled) setState({ status: "ready", items });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load questions.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleAnswered(id: string) {
    setState((prev) => (prev.status === "ready" ? { status: "ready", items: prev.items.filter((q) => q.id !== id) } : prev));
  }

  if (state.status === "loading") {
    return <p data-testid="question-inbox-loading">Loading questions…</p>;
  }

  if (state.status === "error") {
    return (
      <p data-testid="question-inbox-error" role="alert" className="question-inbox__error">
        Couldn&apos;t load questions right now. {state.message}
      </p>
    );
  }

  if (state.items.length === 0) {
    return <p data-testid="question-inbox-empty">No pending questions</p>;
  }

  return (
    <ul data-testid="question-inbox" className="question-inbox">
      {state.items.map((item) => (
        <li key={item.id} className="question-inbox__item">
          <QuestionCard question={item} onAnswered={handleAnswered} />
        </li>
      ))}
    </ul>
  );
}
