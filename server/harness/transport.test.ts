/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileHarnessTransport, PantheonHarnessTransport, NOOP_HARNESS_TRANSPORT } from "./transport.js";

// Restore vi mocks after each test (needed by PantheonHarnessTransport tests)
afterEach(() => {
  vi.restoreAllMocks();
});

describe("NOOP_HARNESS_TRANSPORT", () => {
  it("always returns NO_ADAPTER without spawning anything", async () => {
    const result = await NOOP_HARNESS_TRANSPORT.invoke("proposeChange", { proposalId: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NO_ADAPTER");
  });
});

describe("FileHarnessTransport", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function tempDir() {
    const d = mkdtempSync(join(tmpdir(), "consus-handoff-test-"));
    tmpDirs.push(d);
    return d;
  }

  it("creates handoffsDir if it does not exist and writes the envelope file", async () => {
    const handoffsDir = join(tempDir(), "deep", "handoffs");
    const transport = new FileHarnessTransport(handoffsDir);

    const result = await transport.invoke("proposeChange", {
      proposalId: "p1",
      itemId: "item-1",
      targetType: "diagram",
      diff: "+ added X",
      description: "add X",
    });

    expect(result.ok).toBe(true);
    const files = readdirSync(handoffsDir);
    expect(files).toContain("p1.json");
  });

  it("writes a valid JSON envelope containing all proposeChange params", async () => {
    const handoffsDir = tempDir();
    const transport = new FileHarnessTransport(handoffsDir);
    const params = {
      proposalId: "p2",
      itemId: "item-2",
      targetType: "doc",
      diff: "- removed line\n+ added line",
      description: "update doc",
    };

    await transport.invoke("proposeChange", params);

    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(join(handoffsDir, "p2.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed).toMatchObject(params);
  });

  it("names the file <proposalId>.json so the handoff command can address it by id", async () => {
    const handoffsDir = tempDir();
    const transport = new FileHarnessTransport(handoffsDir);

    await transport.invoke("proposeChange", { proposalId: "abc-123", itemId: "i", targetType: "t", diff: "d", description: "d" });

    expect(existsSync(join(handoffsDir, "abc-123.json"))).toBe(true);
  });

  it("does not write any file outside handoffsDir", async () => {
    const handoffsDir = tempDir();
    const siblingDir = tempDir();
    const transport = new FileHarnessTransport(handoffsDir);

    await transport.invoke("proposeChange", { proposalId: "p3", itemId: "i", targetType: "t", diff: "d", description: "d" });

    expect(readdirSync(siblingDir)).toHaveLength(0);
  });

  it("returns UNKNOWN_METHOD for any method other than proposeChange", async () => {
    const transport = new FileHarnessTransport(tempDir());
    const result = await transport.invoke("unknownMethod", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNKNOWN_METHOD");
  });

  it("returns INTERNAL_ERROR when params are missing proposalId", async () => {
    const transport = new FileHarnessTransport(tempDir());
    const result = await transport.invoke("proposeChange", { itemId: "i" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INTERNAL_ERROR");
  });

  it("each proposal gets its own file — multiple proposals coexist without collision", async () => {
    const handoffsDir = tempDir();
    const transport = new FileHarnessTransport(handoffsDir);

    for (const id of ["pa", "pb", "pc"]) {
      await transport.invoke("proposeChange", { proposalId: id, itemId: "i", targetType: "t", diff: "d", description: "d" });
    }

    const files = readdirSync(handoffsDir).sort();
    expect(files).toEqual(["pa.json", "pb.json", "pc.json"]);
  });
});

const PANTHEON_URL = "https://pantheon.example.com";

const baseParams = {
  proposalId: "prop-1",
  itemId: "item-1",
  targetType: "decision",
  diff: "--- a\n+++ b\n-old\n+new",
  description: "Update decision",
  sourceRepo: "mdostal/minerva",
};

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
