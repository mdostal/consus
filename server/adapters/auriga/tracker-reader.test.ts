import { describe, it, expect } from "vitest";
import { AurigaTrackerReader, type AurigaTrackerTransport } from "./tracker-reader.js";

function fakeTransport(state: Record<string, string>): AurigaTrackerTransport {
  return {
    async getEventState(eventId: string) {
      return state[eventId] ? { ok: true, state: state[eventId] } : { ok: false, error: "not found" };
    },
  };
}

describe("AurigaTrackerReader", () => {
  it("displays current dispatch/close/error/retry state via the read-only transport", async () => {
    const transport = fakeTransport({ "event-1": "dispatched" });
    const reader = new AurigaTrackerReader(transport);

    const state = await reader.getState("event-1");

    expect(state).toEqual({ ok: true, state: "dispatched" });
  });

  it("reflects a state change on next read", async () => {
    const state: Record<string, string> = { "event-1": "dispatched" };
    const transport = fakeTransport(state);
    const reader = new AurigaTrackerReader(transport);

    expect(await reader.getState("event-1")).toEqual({ ok: true, state: "dispatched" });

    state["event-1"] = "closed";
    expect(await reader.getState("event-1")).toEqual({ ok: true, state: "closed" });
  });

  it("has no public method that can dispatch, claim, or close — read-only by construction", () => {
    const transport = fakeTransport({});
    const reader = new AurigaTrackerReader(transport);

    const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(reader));
    expect(publicMethods).not.toContain("dispatch");
    expect(publicMethods).not.toContain("claim");
    expect(publicMethods).not.toContain("close");
  });
});
