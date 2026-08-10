import { describe, it, expect, vi } from "vitest";
import { parseYaml } from "./yaml-parser.js";

describe("parseYaml", () => {
  it("parses simple key-value pairs", () => {
    const yaml = `
id: story-01
epic: consus-v1
title: Server skeleton
`;
    expect(parseYaml(yaml)).toEqual({
      id: "story-01",
      epic: "consus-v1",
      title: "Server skeleton",
    });
  });

  it("parses block scalars", () => {
    const yaml = `
description: |
  Bootstrap Fastify server
  With some lines
`;
    expect(parseYaml(yaml)).toEqual({
      description: "Bootstrap Fastify server\nWith some lines",
    });
  });

  it("skips malformed yaml and logs warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const yaml = `not a valid yaml`;
    expect(parseYaml(yaml)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
