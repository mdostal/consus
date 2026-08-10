import { describe, it, expect, vi } from "vitest";
import { parkWorkflow, waitForResume, type FetchLike, type ParkedState } from "./park.js";

function jsonResponse(body: unknown, status = 200): Awaited<ReturnType<FetchLike>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async json() {
      return body;
    },
  };
}

describe("Minerva workflow parking", () => {
  const parkedState: ParkedState = {
    workflow_type: "planning",
    context: {
      epic_id: "consus-v1-core-871",
      requirement: "choose workflow parking contract",
    },
  };

  it("parks a blocking question through Consus and returns the park_id", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ park_id: "park-123" }));

    const parkId = await parkWorkflow("Which API contract should Minerva use?", parkedState, {
      consusUrl: "http://consus.test/",
      fetch,
    });

    expect(parkId).toBe("park-123");
    expect(fetch).toHaveBeenCalledWith("http://consus.test/api/workflows/park", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_name: "minerva",
        workflow_type: "planning",
        parked_state: JSON.stringify(parkedState),
        question_text: "Which API contract should Minerva use?",
      }),
    });
  });

  it("polls workflow status with exponential backoff until an answer is resumed", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ status: "parked" }))
      .mockResolvedValueOnce(jsonResponse({ status: "parked" }))
      .mockResolvedValueOnce(jsonResponse({ status: "resumed", answer: "Use the workflow park endpoint." }));
    const sleepCalls: number[] = [];
    let elapsedMs = 0;

    const answer = await waitForResume("park-123", {
      consusUrl: "http://consus.test",
      fetch,
      sleep: async (delayMs) => {
        sleepCalls.push(delayMs);
        elapsedMs += delayMs;
      },
      now: () => elapsedMs,
    });

    expect(answer).toBe("Use the workflow park endpoint.");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(1, "http://consus.test/api/workflows/park-123/status");
    expect(fetch).toHaveBeenNthCalledWith(2, "http://consus.test/api/workflows/park-123/status");
    expect(fetch).toHaveBeenNthCalledWith(3, "http://consus.test/api/workflows/park-123/status");
    expect(sleepCalls).toEqual([2_000, 4_000]);
  });

  it("caps resume polling backoff at 30 seconds", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ status: "parked" }))
      .mockResolvedValueOnce(jsonResponse({ status: "parked" }))
      .mockResolvedValueOnce(jsonResponse({ status: "parked" }))
      .mockResolvedValueOnce(jsonResponse({ status: "parked" }))
      .mockResolvedValueOnce(jsonResponse({ status: "parked" }))
      .mockResolvedValueOnce(jsonResponse({ status: "resumed", answer: "Continue." }));
    const sleepCalls: number[] = [];
    let elapsedMs = 0;

    await waitForResume("park-456", {
      consusUrl: "http://consus.test",
      fetch,
      sleep: async (delayMs) => {
        sleepCalls.push(delayMs);
        elapsedMs += delayMs;
      },
      now: () => elapsedMs,
      maxWaitMs: 120_000,
    });

    expect(sleepCalls).toEqual([2_000, 4_000, 8_000, 16_000, 30_000]);
  });

  it("times out when no resumed answer arrives within the wait budget", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ status: "parked" }));
    const sleepCalls: number[] = [];
    let elapsedMs = 0;

    await expect(
      waitForResume("park-timeout", {
        consusUrl: "http://consus.test",
        fetch,
        maxWaitMs: 10_000,
        sleep: async (delayMs) => {
          sleepCalls.push(delayMs);
          elapsedMs += delayMs;
        },
        now: () => elapsedMs,
      }),
    ).rejects.toThrow("Timeout waiting for resume on workflow park-timeout");

    expect(sleepCalls).toEqual([2_000, 4_000, 4_000]);
  });

  it("retries transient polling failures before continuing the resume wait", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockResolvedValueOnce(jsonResponse({ status: "parked" }))
      .mockResolvedValueOnce(jsonResponse({ status: "resumed", answer: "Retry succeeded." }));
    const sleepCalls: number[] = [];
    let elapsedMs = 0;

    const answer = await waitForResume("park-retry", {
      consusUrl: "http://consus.test",
      fetch,
      sleep: async (delayMs) => {
        sleepCalls.push(delayMs);
        elapsedMs += delayMs;
      },
      now: () => elapsedMs,
    });

    expect(answer).toBe("Retry succeeded.");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleepCalls).toEqual([2_000, 4_000]);
  });
});
