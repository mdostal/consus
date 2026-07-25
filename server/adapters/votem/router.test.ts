import { describe, it, expect } from "vitest";
import { VotemRouter, type VotemTransport } from "./router.js";

describe("VotemRouter", () => {
  it("hands a quorum-scoped item to votem and returns its resulting state", async () => {
    const transport: VotemTransport = {
      async routeToQuorum(itemId: string) {
        return { ok: true, state: { status: "tied", tiebreak: null } };
      },
    };
    const router = new VotemRouter(transport);

    const result = await router.route("item-1");

    expect(result).toEqual({ ok: true, state: { status: "tied", tiebreak: null } });
  });

  it("surfaces a clear 'quorum unavailable' state when votem is unreachable, never a silent direct-decision fallback", async () => {
    const transport: VotemTransport = {
      async routeToQuorum() {
        return { ok: false, error: "ECONNREFUSED" };
      },
    };
    const router = new VotemRouter(transport);

    const result = await router.route("item-1");

    expect(result).toEqual({ ok: false, reason: "quorum-unavailable", error: "ECONNREFUSED" });
  });

  it("never implements voting logic itself — no vote/tally/count method exists", () => {
    const transport: VotemTransport = { async routeToQuorum() { return { ok: true, state: {} }; } };
    const router = new VotemRouter(transport);

    const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(router));
    expect(publicMethods).not.toContain("vote");
    expect(publicMethods).not.toContain("tally");
  });
});
