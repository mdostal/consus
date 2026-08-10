import { API_BASE_URL } from "../config";

export interface Question {
  id: string;
  text: string;
  agent_name: string;
  created_at: string;
  status: string;
}

export interface SubmitAnswerInput {
  answer: string;
  actor: string;
}

async function errorDetail(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
}

/**
 * [frontend-api-integration]: fetches pending questions from
 * GET /api/questions (see PAN-8233 server/routes/questions.ts) — a bare
 * JSON array of human_requests rows, ordered by created_at DESC.
 */
export async function fetchQuestions(): Promise<Question[]> {
  const response = await fetch(`${API_BASE_URL}/api/questions`);

  if (!response.ok) {
    throw new Error(`Failed to load questions: ${await errorDetail(response)}`);
  }

  return response.json();
}

/**
 * POSTs an answer to /api/questions/:id/answer. Throws on non-2xx so the
 * caller (QuestionCard) can surface the error and keep the draft answer.
 */
export async function submitAnswer(id: string, input: SubmitAnswerInput): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/questions/${id}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit answer: ${await errorDetail(response)}`);
  }
}
