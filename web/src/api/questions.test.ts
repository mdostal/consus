import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchQuestions, submitAnswer } from "./questions";

const QUESTIONS = [
  { id: "1", text: "Which DAG engine?", agent_name: "auriga-build", created_at: "2026-08-10T03:44:04Z", status: "pending" },
];

function mockFetchOnce(response: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: response.json,
    }),
  );
}

describe("fetchQuestions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Given the server is running, fetches /api/questions", async () => {
    mockFetchOnce({ ok: true, json: async () => QUESTIONS });

    const result = await fetchQuestions();

    expect(fetch).toHaveBeenCalledWith("/api/questions");
    expect(result).toEqual(QUESTIONS);
  });

  it("Given the API returns a 503 with an error body, rejects with a descriptive message", async () => {
    mockFetchOnce({ ok: false, status: 503, json: async () => ({ error: "DB unavailable" }) });

    await expect(fetchQuestions()).rejects.toThrow(/DB unavailable/);
  });

  it("Given the API returns a non-ok response with no parseable body, still rejects with the HTTP status", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => { throw new Error("not json"); } });

    await expect(fetchQuestions()).rejects.toThrow(/HTTP 500/);
  });
});

describe("submitAnswer", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Given a pending question, POSTs the answer and actor to /api/questions/:id/answer", async () => {
    mockFetchOnce({ ok: true, json: async () => ({}) });

    await submitAnswer("1", { answer: "Use React Flow.", actor: "operator" });

    expect(fetch).toHaveBeenCalledWith("/api/questions/1/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "Use React Flow.", actor: "operator" }),
    });
  });

  it("Given the question is already answered, rejects with the 409 error detail", async () => {
    mockFetchOnce({ ok: false, status: 409, json: async () => ({ error: "already answered" }) });

    await expect(submitAnswer("1", { answer: "x", actor: "operator" })).rejects.toThrow(/already answered/);
  });

  it("Given an unknown question id, rejects with the 404 status", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => { throw new Error("not json"); } });

    await expect(submitAnswer("missing", { answer: "x", actor: "operator" })).rejects.toThrow(/HTTP 404/);
  });
});
