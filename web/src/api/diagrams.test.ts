import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCascadeDiagram, fetchRepoDiagram } from "./diagrams";

const REPO_DIAGRAM = {
  topLevel: "graph TD\n  app[App]",
  fullComponent: "graph TD\n  app[App]\n  app --> api[API]",
};

const CASCADE_DIAGRAM = {
  mermaid: "graph LR\n  seed[Seed]",
  cached_at: "2026-08-10T02:00:00.000Z",
  stale: false,
};

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

describe("diagram API client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a repo diagram with the encoded repo key", async () => {
    mockFetchOnce({ ok: true, json: async () => REPO_DIAGRAM });

    const result = await fetchRepoDiagram("pantheon core");

    expect(fetch).toHaveBeenCalledWith("/api/diagrams/pantheon%20core");
    expect(result).toEqual(REPO_DIAGRAM);
  });

  it("rejects blank repo keys before calling fetch", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(fetchRepoDiagram("   ")).rejects.toThrow(/repo is required/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches the cascade org-tree diagram", async () => {
    mockFetchOnce({ ok: true, json: async () => CASCADE_DIAGRAM });

    const result = await fetchCascadeDiagram();

    expect(fetch).toHaveBeenCalledWith("/api/diagrams/cascade");
    expect(result).toEqual(CASCADE_DIAGRAM);
  });

  it("surfaces server error details when diagram loading fails", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({ error: "Unknown repo" }) });

    await expect(fetchRepoDiagram("missing")).rejects.toThrow(/Unknown repo/);
  });

  it("falls back to the HTTP status when the error body is not parseable", async () => {
    mockFetchOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });

    await expect(fetchCascadeDiagram()).rejects.toThrow(/HTTP 502/);
  });
});
