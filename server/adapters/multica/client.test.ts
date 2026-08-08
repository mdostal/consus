import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HttpMulticaClient, resolveMulticaToken } from "./client.js";

describe("HttpMulticaClient", () => {
  it("writes a comment via the configured server URL and returns the remote comment id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mc-comment-123" }),
    });
    const client = new HttpMulticaClient({
      serverUrl: "https://api.example.com",
      workspaceId: "ws-1",
      token: "tok-1",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.writeComment({ itemId: "item-1", author: "mathew", body: "looks good" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.multicaCommentId).toBe("mc-comment-123");
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/comments",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a clear failure when Multica is unreachable rather than silently dropping the write", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new HttpMulticaClient({
      serverUrl: "https://api.example.com",
      workspaceId: "ws-1",
      token: "tok-1",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.writeComment({ itemId: "item-1", author: "mathew", body: "looks good" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ECONNREFUSED");
    }
  });

  it("sends a bearer Authorization header and X-Workspace-ID header on every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mc-comment-123" }),
    });
    const client = new HttpMulticaClient({
      serverUrl: "https://api.example.com",
      workspaceId: "ws-42",
      token: "secret-token",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.writeComment({ itemId: "item-1", author: "mathew", body: "looks good" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/comments",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret-token",
          "x-workspace-id": "ws-42",
        }),
      }),
    );
  });

  it("resolves the token from options when constructing, not from the environment, when a token is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "mc-1" }) });
    const client = new HttpMulticaClient({
      serverUrl: "https://api.example.com",
      workspaceId: "ws-1",
      token: "explicit-token",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.writeComment({ itemId: "item-1", author: "mathew", body: "hi" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer explicit-token" }) }),
    );
  });

  it("defaults to a 20s request timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const pending = client.writeComment({ itemId: "item-1", author: "mathew", body: "hi" });
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await pending;

      expect(result.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("listIssues", () => {
    function issuePage(count: number, offset: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: `issue-${offset + i}`,
        identifier: `MUL-${offset + i}`,
        title: `Issue ${offset + i}`,
        description: null,
        status: "in_review",
        priority: "none",
        labels: [{ name: "decision" }],
        updated_at: "2026-08-01T00:00:00Z",
        created_at: "2026-08-01T00:00:00Z",
      }));
    }

    it("normalizes a single page of issues from the API's snake_case shape", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues: issuePage(3, 0) }),
      });
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await client.listIssues();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.issues).toHaveLength(3);
        expect(result.issues[0]).toMatchObject({
          id: "issue-0",
          identifier: "MUL-0",
          title: "Issue 0",
          labels: ["decision"],
        });
      }
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("https://api.example.com/issues?"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({ authorization: "Bearer tok-1", "x-workspace-id": "ws-1" }),
        }),
      );
    });

    it("preserves the ~200-issue batch-fetch behavior by paginating in 100-row pages", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const offset = Number(new URL(url).searchParams.get("offset"));
        return Promise.resolve({ ok: true, json: async () => ({ issues: issuePage(100, offset) }) });
      });
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await client.listIssues();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.issues).toHaveLength(200);
        expect(result.issues[0].id).toBe("issue-0");
        expect(result.issues[199].id).toBe("issue-199");
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("stops paginating once a short page signals the last page", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issues: issuePage(40, 0) }),
      });
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await client.listIssues();

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.issues).toHaveLength(40);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("respects a caller-supplied limit smaller than a full page", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues: issuePage(10, 0) }),
      });
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await client.listIssues({ limit: 5 });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.issues).toHaveLength(5);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("limit=5"),
        expect.anything(),
      );
    });

    it("surfaces a clear failure when a page request fails rather than returning a partial silent result", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await client.listIssues();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("503");
    });
  });

  it("fetches a single issue by key and normalizes the API envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issue: {
          id: "issue-1",
          identifier: "PAN-1",
          title: "Iterate this",
          description: null,
          status: "todo",
          priority: "medium",
          labels: [],
          updated_at: null,
          created_at: null,
        },
      }),
    });
    const client = new HttpMulticaClient({
      serverUrl: "https://api.example.com",
      workspaceId: "ws-1",
      token: "tok-1",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.getIssue("PAN-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.issue).toMatchObject({ id: "issue-1", identifier: "PAN-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/issues/PAN-1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer tok-1", "x-workspace-id": "ws-1" }),
      }),
    );
  });

  it("updates issue status with a PUT and reports the returned status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issue: {
          id: "issue-1",
          identifier: "PAN-1",
          title: "Iterate this",
          description: null,
          status: "in_progress",
          priority: "medium",
          labels: [],
          updated_at: null,
          created_at: null,
        },
      }),
    });
    const client = new HttpMulticaClient({
      serverUrl: "https://api.example.com",
      workspaceId: "ws-1",
      token: "tok-1",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.updateIssueStatus("issue-1", "in_progress");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("in_progress");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/issues/issue-1",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "content-type": "application/json",
          authorization: "Bearer tok-1",
          "x-workspace-id": "ws-1",
        }),
        body: JSON.stringify({ status: "in_progress" }),
      }),
    );
  });
});

describe("resolveMulticaToken", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "consus-multica-token-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prefers MULTICA_TOKEN from the environment over any config file", () => {
    const mtokPath = join(tmpDir, "mtok");
    writeFileSync(mtokPath, "file-token\n");

    const token = resolveMulticaToken({ MULTICA_TOKEN: "env-token" }, [mtokPath]);

    expect(token).toBe("env-token");
  });

  it("falls back to a plaintext token file when no env var is set", () => {
    const mtokPath = join(tmpDir, "mtok");
    writeFileSync(mtokPath, "file-token\n");

    const token = resolveMulticaToken({}, [mtokPath]);

    expect(token).toBe("file-token");
  });

  it("falls back to the .token field of a JSON config file", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ token: "json-token" }));

    const token = resolveMulticaToken({}, [configPath]);

    expect(token).toBe("json-token");
  });

  it("tries candidate paths in order, skipping ones that don't exist or lack a token", () => {
    const missingPath = join(tmpDir, "does-not-exist");
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ token: "second-candidate-token" }));

    const token = resolveMulticaToken({}, [missingPath, configPath]);

    expect(token).toBe("second-candidate-token");
  });

  it("throws a clear error when no token can be found anywhere", () => {
    const missingPath = join(tmpDir, "does-not-exist");

    expect(() => resolveMulticaToken({}, [missingPath])).toThrow(/no.*token/i);
  });
});
