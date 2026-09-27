/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { PantheonHarnessTransport } from "./transport.js";

const PANTHEON_URL = "https://pantheon.example.com";

const baseParams = {
  proposalId: "prop-1",
  itemId: "item-1",
  targetType: "decision",
  diff: "--- a\n+++ b\n-old\n+new",
  description: "Update decision",
  sourceRepo: "mdostal/minerva",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PantheonHarnessTransport.invoke('proposeChange')", () => {
  it("happy path: returns ok:true with the parsed response body on success", async () => {
    const mockBody = { ticket_id: "ticket-abc", status: "pending" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockBody,
      text: async () => JSON.stringify(mockBody),
    }));

    const transport = new PantheonHarnessTransport(PANTHEON_URL);
    const result = await transport.invoke("proposeChange", baseParams);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual(mockBody);
    }
  });

  it("request body shape: origin.god === 'consus', item_ref fields, target_repo, diff, description", async () => {
    let capturedBody: unknown;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(opts.body as string);
      return { ok: true, json: async () => ({ ticket_id: "t1" }) };
    }));

    const transport = new PantheonHarnessTransport(PANTHEON_URL);
    await transport.invoke("proposeChange", {
      proposalId: "p1",
      itemId: "i1",
      targetType: "diagram",
      diff: "diff content",
      description: "Some description",
      sourceRepo: "mdostal/minerva",
    });

    expect(capturedBody).toMatchObject({
      origin: {
        god: "consus",
        item_ref: {
          itemId: "i1",
          proposalId: "p1",
          targetType: "diagram",
        },
      },
      target_repo: "mdostal/minerva",
      diff: "diff content",
      description: "Some description",
    });
  });

  it("HTTP error: returns ok:false with INTERNAL_ERROR (not a thrown exception)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Unprocessable entity",
    }));

    const transport = new PantheonHarnessTransport(PANTHEON_URL);
    const result = await transport.invoke("proposeChange", baseParams);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.message).toBe("Unprocessable entity");
    }
  });

  it("5xx HTTP error: recoverable flag is true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service unavailable",
    }));

    const transport = new PantheonHarnessTransport(PANTHEON_URL);
    const result = await transport.invoke("proposeChange", baseParams);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.recoverable).toBe(true);
    }
  });

  it("network error (fetch throws): returns ok:false INTERNAL_ERROR without propagating", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const transport = new PantheonHarnessTransport(PANTHEON_URL);
    const result = await transport.invoke("proposeChange", baseParams);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.message).toBe("connection refused");
    }
  });

  it("missing source_repo (null): returns OPERATION_UNSUPPORTED without making a network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const transport = new PantheonHarnessTransport(PANTHEON_URL);
    const result = await transport.invoke("proposeChange", { ...baseParams, sourceRepo: null });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("OPERATION_UNSUPPORTED");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("missing source_repo (undefined): returns OPERATION_UNSUPPORTED without making a network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const transport = new PantheonHarnessTransport(PANTHEON_URL);
    const { sourceRepo: _omit, ...noSourceRepo } = baseParams;
    const result = await transport.invoke("proposeChange", noSourceRepo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("OPERATION_UNSUPPORTED");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("PantheonHarnessTransport.invoke — unknown method", () => {
  it("returns UNKNOWN_METHOD for any method other than 'proposeChange'", async () => {
    const transport = new PantheonHarnessTransport(PANTHEON_URL);
    const result = await transport.invoke("applyDiff");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNKNOWN_METHOD");
    }
  });

  it("does not make a network call for unknown methods", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const transport = new PantheonHarnessTransport(PANTHEON_URL);
    await transport.invoke("someOtherMethod", { anything: true });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
