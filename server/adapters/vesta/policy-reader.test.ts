import { describe, it, expect } from "vitest";
import { VestaPolicyAdapter, type VestaTransport } from "./policy-reader.js";

describe("VestaPolicyAdapter", () => {
  it("resolves auto-accept when policy is 'auto'", async () => {
    const transport: VestaTransport = {
      async getPolicy() {
        return { ok: true, policy: { mode: "auto" } };
      },
    };
    const adapter = new VestaPolicyAdapter(transport);

    const resolution = await adapter.resolve({ repo: "consus", decisionType: "doc", risk: "low" });

    expect(resolution.humanGateRequired).toBe(false);
  });

  it("surfaces a human gate when policy flags strategic/ambiguous/irreversible", async () => {
    const transport: VestaTransport = {
      async getPolicy() {
        return { ok: true, policy: { mode: "gate", flags: ["irreversible"] } };
      },
    };
    const adapter = new VestaPolicyAdapter(transport);

    const resolution = await adapter.resolve({ repo: "consus", decisionType: "cba", risk: "high" });

    expect(resolution.humanGateRequired).toBe(true);
    expect(resolution.flags).toContain("irreversible");
  });

  it("falls back to a local default policy (auto / bare gate) when Vesta is unreachable, standalone mode", async () => {
    const transport: VestaTransport = {
      async getPolicy() {
        return { ok: false, error: "unreachable" };
      },
    };
    const adapter = new VestaPolicyAdapter(transport, { standaloneDefault: "bare-gate" });

    const resolution = await adapter.resolve({ repo: "consus", decisionType: "doc", risk: "low" });

    expect(resolution.humanGateRequired).toBe(true);
    expect(resolution.source).toBe("standalone-default");
  });

  it("never exposes a policy-configuration method — Consus reads and enforces, it does not own the setting", () => {
    const transport: VestaTransport = { async getPolicy() { return { ok: true, policy: { mode: "auto" } }; } };
    const adapter = new VestaPolicyAdapter(transport);

    const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter));
    expect(publicMethods).not.toContain("setPolicy");
    expect(publicMethods).not.toContain("updatePolicy");
  });
});
