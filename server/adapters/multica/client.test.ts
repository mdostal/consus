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
    // listIssues shells out to the `multica` CLI (`issue list --output json`)
    // rather than REST — confirmed live during this story that the assumed
    // `${serverUrl}/issues` REST endpoint 404s; the CLI is the verified
    // integration point. execImpl is injectable so these tests never spawn
    // a real process.

    it("normalizes a page of issues from the CLI's snake_case JSON shape", async () => {
      const execMock = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          issues: [
            {
              id: "i-1",
              identifier: "DOS-1",
              title: "Ship it?",
              description: "body text",
              status: "todo",
              priority: "p1",
              labels: [{ name: "decision" }],
              updated_at: "2026-08-01T00:00:00Z",
              created_at: "2026-07-01T00:00:00Z",
              parent_issue_id: null,
            },
          ],
        }),
        stderr: "",
      });
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        execImpl: execMock,
      });

      const result = await client.listIssues();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.issues).toEqual([
          {
            id: "i-1",
            identifier: "DOS-1",
            title: "Ship it?",
            description: "body text",
            status: "todo",
            priority: "p1",
            labels: ["decision"],
            updatedAt: "2026-08-01T00:00:00Z",
            createdAt: "2026-07-01T00:00:00Z",
            parentId: null,
          },
        ]);
      }
      expect(execMock).toHaveBeenCalledWith(
        "multica",
        expect.arrayContaining(["issue", "list", "--output", "json"]),
      );
    });

    it("passes status and project filters through as CLI flags", async () => {
      const execMock = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ issues: [] }), stderr: "" });
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        execImpl: execMock,
      });

      await client.listIssues({ status: "todo", project: "proj-123" });

      expect(execMock).toHaveBeenCalledWith(
        "multica",
        expect.arrayContaining(["--status", "todo", "--project", "proj-123"]),
      );
    });

    it("drops entries missing a required field (id/title/status) instead of throwing", async () => {
      const execMock = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ issues: [{ id: "i-1" }, { id: "i-2", title: "ok", status: "todo" }] }),
        stderr: "",
      });
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        execImpl: execMock,
      });

      const result = await client.listIssues();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.issues.map((i) => i.id)).toEqual(["i-2"]);
      }
    });

    it("paginates until a short page signals the end", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: `i-${i}`,
        title: `t${i}`,
        status: "todo",
      }));
      const page2 = [{ id: "i-100", title: "last", status: "todo" }];
      const execMock = vi
        .fn()
        .mockResolvedValueOnce({ stdout: JSON.stringify({ issues: page1 }), stderr: "" })
        .mockResolvedValueOnce({ stdout: JSON.stringify({ issues: page2 }), stderr: "" });
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        execImpl: execMock,
      });

      const result = await client.listIssues({ limit: 200 });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.issues).toHaveLength(101);
      expect(execMock).toHaveBeenCalledTimes(2);
    });

    it("surfaces a clear failure when the CLI errors rather than returning an empty list silently", async () => {
      const execMock = vi.fn().mockRejectedValue(new Error("multica: not authenticated"));
      const client = new HttpMulticaClient({
        serverUrl: "https://api.example.com",
        workspaceId: "ws-1",
        token: "tok-1",
        execImpl: execMock,
      });

      const result = await client.listIssues();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("not authenticated");
    });
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
