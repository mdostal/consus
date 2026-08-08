import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchDecisions } from "./decisions";

const ITEMS = [
  { id: "multica:mul-1", type: "multica_issue", title: "Choose the layout", status: "in_review", decision_payload: null, decision_type: "choose", triage_bucket: "open_question" },
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

describe("fetchDecisions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Given the server is running on :8722, fetches /api/decisions (same-origin, proxied to :8722 by Vite in dev)", async () => {
    mockFetchOnce({ ok: true, json: async () => ITEMS });

    const result = await fetchDecisions();

    expect(fetch).toHaveBeenCalledWith("/api/decisions");
    expect(result).toEqual(ITEMS);
  });

  it("Given includeDecided, appends ?all=1 to include already-decided items", async () => {
    mockFetchOnce({ ok: true, json: async () => ITEMS });

    await fetchDecisions({ includeDecided: true });

    expect(fetch).toHaveBeenCalledWith("/api/decisions?all=1");
  });

  it("Given the API returns a 503 with an error body, rejects with a descriptive message", async () => {
    mockFetchOnce({ ok: false, status: 503, json: async () => ({ error: "Multica fetch failed: timeout" }) });

    await expect(fetchDecisions()).rejects.toThrow(/Multica fetch failed: timeout/);
  });

  it("Given the API returns a non-ok response with no parseable body, still rejects with the HTTP status", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => { throw new Error("not json"); } });

    await expect(fetchDecisions()).rejects.toThrow(/HTTP 500/);
  });
});
