/**
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileHarnessTransport, NOOP_HARNESS_TRANSPORT } from "./transport.js";

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
