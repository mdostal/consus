import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchEpics } from "./epics";

describe("fetchEpics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches epics from the API", async () => {
    const mockData = [{ id: "e1", title: "Epic 1" }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const epics = await fetchEpics();
    expect(epics).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith("/api/epics");
  });

  it("throws an error on non-200 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchEpics()).rejects.toThrow("Failed to load epics: HTTP 500");
  });
});
