/**
 * @vitest-environment node
 *
 * Tests for the harness transport selection logic in server/index.ts.
 * Uses the exported selectHarnessTransport() helper so the env-var branching
 * can be exercised without spawning the full server.
 */
import { describe, it, expect } from "vitest";
import { selectHarnessTransport } from "../index.js";
import { PantheonHarnessTransport, StdioHarnessTransport, NOOP_HARNESS_TRANSPORT } from "./transport.js";

describe("selectHarnessTransport — transport selection", () => {
  it("CONSUS_HARNESS=pantheon with PANTHEON_API_URL set → PantheonHarnessTransport", () => {
    const transport = selectHarnessTransport({
      CONSUS_HARNESS: "pantheon",
      PANTHEON_API_URL: "https://pantheon.example.com",
    });
    expect(transport).toBeInstanceOf(PantheonHarnessTransport);
  });

  it("CONSUS_HARNESS=pantheon without PANTHEON_API_URL → throws", () => {
    expect(() =>
      selectHarnessTransport({ CONSUS_HARNESS: "pantheon" }),
    ).toThrow("PANTHEON_API_URL is required");
  });

  it("no env vars → NOOP_HARNESS_TRANSPORT (default unchanged)", () => {
    const transport = selectHarnessTransport({});
    expect(transport).toBe(NOOP_HARNESS_TRANSPORT);
  });

  it("CONSUS_HARNESS_COMMAND set (no CONSUS_HARNESS) → StdioHarnessTransport", () => {
    const transport = selectHarnessTransport({ CONSUS_HARNESS_COMMAND: "/usr/bin/my-harness" });
    expect(transport).toBeInstanceOf(StdioHarnessTransport);
  });

  it("CONSUS_HARNESS_COMMAND set alongside CONSUS_HARNESS=pantheon → PantheonHarnessTransport (pantheon wins)", () => {
    const transport = selectHarnessTransport({
      CONSUS_HARNESS: "pantheon",
      PANTHEON_API_URL: "https://p.example.com",
      CONSUS_HARNESS_COMMAND: "/usr/bin/my-harness",
    });
    expect(transport).toBeInstanceOf(PantheonHarnessTransport);
  });
});
