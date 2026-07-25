import { describe, it, expect, vi } from "vitest";
import { HttpMulticaClient } from "./client.js";

describe("HttpMulticaClient", () => {
  it("writes a comment via the configured server URL and returns the remote comment id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mc-comment-123" }),
    });
    const client = new HttpMulticaClient({ serverUrl: "https://api.example.com", fetchImpl: fetchMock as unknown as typeof fetch });

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
    const client = new HttpMulticaClient({ serverUrl: "https://api.example.com", fetchImpl: fetchMock as unknown as typeof fetch });

    const result = await client.writeComment({ itemId: "item-1", author: "mathew", body: "looks good" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ECONNREFUSED");
    }
  });
});
