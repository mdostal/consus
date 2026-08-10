import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchFiredTickets } from "./fired";

describe("fetchFiredTickets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches fired tickets from the API", async () => {
    const mockData = [
      {
        id: "ft-1",
        multica_issue_id: "PAN-1",
        target_repo: "consus",
        fired_by: "operator",
        fired_at: "2026-08-02T00:00:00.000Z",
        repo: "consus",
        file_path: "docs/a.md",
      },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const tickets = await fetchFiredTickets();
    expect(tickets).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith("/api/fired");
  });

  it("throws an error on non-200 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchFiredTickets()).rejects.toThrow("Failed to load fired tickets: HTTP 500");
  });
});
