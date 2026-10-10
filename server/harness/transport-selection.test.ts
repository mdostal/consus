/**
 * @vitest-environment node
 *
 * Tests for the harness transport selection logic in server/index.ts.
 * Uses the exported selectHarnessTransport() helper so the env-var branching
 * can be exercised without spawning the full server.
 */
import { describe, it, expect } from "vitest";
import { selectHarnessTransport } from "../index.js";
import { PantheonHarnessTransport, FileHarnessTransport, StdioHarnessTransport, WebhookHarnessTransport, NOOP_HARNESS_TRANSPORT } from "./transport.js";

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

  it("CONSUS_HARNESS_FILE_DIR set (no CONSUS_HARNESS) → FileHarnessTransport", () => {
    const transport = selectHarnessTransport({ CONSUS_HARNESS_FILE_DIR: ".pHive/handoffs" });
    expect(transport).toBeInstanceOf(FileHarnessTransport);
  });

  it("CONSUS_HARNESS_FILE_DIR set alongside CONSUS_HARNESS=pantheon → PantheonHarnessTransport (pantheon wins)", () => {
    const transport = selectHarnessTransport({
      CONSUS_HARNESS: "pantheon",
      PANTHEON_API_URL: "https://p.example.com",
      CONSUS_HARNESS_FILE_DIR: ".pHive/handoffs",
    });
    expect(transport).toBeInstanceOf(PantheonHarnessTransport);
  });

  it("CONSUS_HARNESS_FILE_DIR set alongside CONSUS_HARNESS_COMMAND → FileHarnessTransport wins (file takes priority over stdio)", () => {
    const transport = selectHarnessTransport({
      CONSUS_HARNESS_FILE_DIR: ".pHive/handoffs",
      CONSUS_HARNESS_COMMAND: "/usr/bin/my-harness",
    });
    expect(transport).toBeInstanceOf(FileHarnessTransport);
  });

  it("CONSUS_HARNESS=webhook with CONSUS_HARNESS_WEBHOOK_URL → WebhookHarnessTransport", () => {
    const transport = selectHarnessTransport({
      CONSUS_HARNESS: "webhook",
      CONSUS_HARNESS_WEBHOOK_URL: "https://hooks.example.com/consus",
    });
    expect(transport).toBeInstanceOf(WebhookHarnessTransport);
  });

  it("CONSUS_HARNESS=webhook without CONSUS_HARNESS_WEBHOOK_URL → throws", () => {
    expect(() => selectHarnessTransport({ CONSUS_HARNESS: "webhook" })).toThrow(
      "CONSUS_HARNESS_WEBHOOK_URL is required",
    );
  });

  it("CONSUS_HARNESS=webhook with an unparseable URL → throws", () => {
    expect(() =>
      selectHarnessTransport({ CONSUS_HARNESS: "webhook", CONSUS_HARNESS_WEBHOOK_URL: "not a url" }),
    ).toThrow("CONSUS_HARNESS_WEBHOOK_URL is not a valid URL");
  });

  it("CONSUS_HARNESS=webhook wins over CONSUS_HARNESS_FILE_DIR and CONSUS_HARNESS_COMMAND", () => {
    const transport = selectHarnessTransport({
      CONSUS_HARNESS: "webhook",
      CONSUS_HARNESS_WEBHOOK_URL: "https://hooks.example.com/consus",
      CONSUS_HARNESS_FILE_DIR: ".pHive/handoffs",
      CONSUS_HARNESS_COMMAND: "/usr/bin/my-harness",
    });
    expect(transport).toBeInstanceOf(WebhookHarnessTransport);
  });

  it("CONSUS_HARNESS_WEBHOOK_URL alone (no CONSUS_HARNESS=webhook) does not select the webhook", () => {
    const transport = selectHarnessTransport({ CONSUS_HARNESS_WEBHOOK_URL: "https://hooks.example.com/consus" });
    expect(transport).toBe(NOOP_HARNESS_TRANSPORT);
  });
});
