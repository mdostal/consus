/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { PantheonResultPuller } from "./pantheon-result-puller.js";

vi.mock("../proposals/store.js", () => ({
  reportProposalResult: vi.fn().mockResolvedValue({ ok: true }),
}));

import { reportProposalResult } from "../proposals/store.js";

const PANTHEON_URL = "https://pantheon.example.com";

// Minimal db stub — only passed through to reportProposalResult (mocked).
const stubDb = {} as Database.Database;

const change1 = {
  ticket_id: "t1",
  origin_item_ref: { proposalId: "prop-1" },
  result: { status: "applied" as const, applied_diff: "some diff", reason: undefined, at: "2026-01-01T00:00:00Z" },
  updated_at: "2026-01-01T00:00:00Z",
};

const change2 = {
  ticket_id: "t2",
  origin_item_ref: { proposalId: "prop-2" },
  result: { status: "failed" as const, applied_diff: undefined, reason: "conflict", at: "2026-01-01T00:01:00Z" },
  updated_at: "2026-01-01T00:01:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PantheonResultPuller.poll — happy path", () => {
  it("calls reportProposalResult once per result with correct applied|failed status and diff", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ changes: [change1, change2] }),
    }));

    const puller = new PantheonResultPuller(PANTHEON_URL, stubDb);
    await puller.poll();

    expect(reportProposalResult).toHaveBeenCalledTimes(2);
    expect(reportProposalResult).toHaveBeenCalledWith(stubDb, {
      proposalId: "prop-1",
      status: "applied",
      appliedDiff: "some diff",
      reason: undefined,
    });
    expect(reportProposalResult).toHaveBeenCalledWith(stubDb, {
      proposalId: "prop-2",
      status: "failed",
      appliedDiff: undefined,
      reason: "conflict",
    });
  });
});

describe("PantheonResultPuller.poll — empty response", () => {
  it("makes no calls to reportProposalResult when changes array is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ changes: [] }),
    }));

    const puller = new PantheonResultPuller(PANTHEON_URL, stubDb);
    await puller.poll();

    expect(reportProposalResult).not.toHaveBeenCalled();
  });
});

describe("PantheonResultPuller.poll — cursor advancement", () => {
  it("first poll sends no 'since' param; second poll sends the cursor from the first response", async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      capturedUrls.push(url);
      return {
        ok: true,
        json: async () => ({ changes: [change1] }),
      };
    }));

    const puller = new PantheonResultPuller(PANTHEON_URL, stubDb);
    await puller.poll();
    await puller.poll();

    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[0]).not.toContain("since=");
    expect(capturedUrls[1]).toContain("since=");
    // cursor should be the updated_at from change1
    expect(decodeURIComponent(capturedUrls[1])).toContain("since=2026-01-01T00:00:00Z");
  });

  it("cursor advances to the latest updated_at when multiple changes are returned", async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      capturedUrls.push(url);
      return {
        ok: true,
        json: async () => ({ changes: [change1, change2] }),
      };
    }));

    const puller = new PantheonResultPuller(PANTHEON_URL, stubDb);
    await puller.poll(); // ingests both; cursor = change2's updated_at (later)
    await puller.poll();

    expect(decodeURIComponent(capturedUrls[1])).toContain("since=2026-01-01T00:01:00Z");
  });
});

describe("PantheonResultPuller.poll — HTTP error", () => {
  it("silently returns without calling reportProposalResult on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const puller = new PantheonResultPuller(PANTHEON_URL, stubDb);
    await puller.poll();

    expect(reportProposalResult).not.toHaveBeenCalled();
  });

  it("silently returns without throwing when fetch itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const puller = new PantheonResultPuller(PANTHEON_URL, stubDb);
    await expect(puller.poll()).resolves.toBeUndefined();
    expect(reportProposalResult).not.toHaveBeenCalled();
  });
});

describe("PantheonResultPuller.poll — query parameters", () => {
  it("always sends origin_god=consus and has_result=true", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ changes: [] }) };
    }));

    const puller = new PantheonResultPuller(PANTHEON_URL, stubDb);
    await puller.poll();

    expect(capturedUrl).toContain("origin_god=consus");
    expect(capturedUrl).toContain("has_result=true");
  });
});
