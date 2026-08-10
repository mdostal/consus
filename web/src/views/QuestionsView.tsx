import { useEffect, useState } from "react";

interface Question {
  id: string;
  agent_name: string;
  context: string | null;
  question: string;
  created_at: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; questions: Question[] };

export function QuestionsView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [answerText, setAnswerText] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function fetchQuestions() {
      setState({ status: "loading" });

      try {
        const response = await fetch("/api/questions");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const questions = (await response.json()) as Question[];
        if (!cancelled) {
          setState({ status: "ready", questions });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    }

    void fetchQuestions();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submitAnswer(questionId: string) {
    const answer = answerText[questionId]?.trim();
    if (!answer || submitting[questionId]) {
      return;
    }

    setSubmitting((prev) => ({ ...prev, [questionId]: true }));
    setSubmitError((prev) => {
      const { [questionId]: _cleared, ...rest } = prev;
      return rest;
    });

    try {
      const response = await fetch(`/api/questions/${encodeURIComponent(questionId)}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer, actor: "mathew" }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setState((prev) =>
        prev.status === "ready"
          ? { status: "ready", questions: prev.questions.filter((q) => q.id !== questionId) }
          : prev,
      );
      setAnswerText((prev) => {
        const { [questionId]: _answered, ...rest } = prev;
        return rest;
      });
    } catch {
      setSubmitError((prev) => ({ ...prev, [questionId]: "Unable to submit answer" }));
    } finally {
      setSubmitting((prev) => {
        const { [questionId]: _answered, ...rest } = prev;
        return rest;
      });
    }
  }

  if (state.status === "loading") {
    return <p data-testid="questions-loading">Loading questions...</p>;
  }

  if (state.status === "error") {
    return (
      <p data-testid="questions-error" role="alert" className="decision-list__error">
        Unable to load questions
      </p>
    );
  }

  if (state.questions.length === 0) {
    return <p data-testid="questions-empty">No parked questions</p>;
  }

  return (
    <section className="questions-view" aria-labelledby="questions-heading">
      <h2 id="questions-heading">Question Inbox</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Context</th>
            <th scope="col">Question</th>
            <th scope="col">Answer</th>
          </tr>
        </thead>
        <tbody>
          {state.questions.map((question) => (
            <tr key={question.id}>
              <td>{question.agent_name}</td>
              <td>{question.context || "-"}</td>
              <td>{question.question}</td>
              <td>
                <textarea
                  aria-label={`Answer ${question.question}`}
                  value={answerText[question.id] || ""}
                  onChange={(event) =>
                    setAnswerText((prev) => ({ ...prev, [question.id]: event.target.value }))
                  }
                  placeholder="Type your answer..."
                />
                <button
                  type="button"
                  onClick={() => void submitAnswer(question.id)}
                  disabled={!answerText[question.id]?.trim() || submitting[question.id]}
                >
                  {submitting[question.id] ? "Submitting..." : "Submit"}
                </button>
                {submitError[question.id] ? (
                  <p role="alert" className="decision-list__error">
                    {submitError[question.id]}
                  </p>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
