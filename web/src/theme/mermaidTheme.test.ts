import { describe, it, expect, afterEach } from "vitest";
import { getMermaidThemeVariables } from "./mermaidTheme";

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("getMermaidThemeVariables", () => {
  it("reads the currently-resolved --consus-* tokens off the document root", () => {
    document.documentElement.style.setProperty("--consus-bg", "#111111");
    document.documentElement.style.setProperty("--consus-bg-subtle", "#222222");
    document.documentElement.style.setProperty("--consus-ink", "#eeeeee");
    document.documentElement.style.setProperty("--consus-line", "#333333");

    const vars = getMermaidThemeVariables();

    expect(vars.background).toBe("#111111");
    expect(vars.primaryColor).toBe("#222222");
    expect(vars.primaryTextColor).toBe("#eeeeee");
    expect(vars.primaryBorderColor).toBe("#333333");
  });

  it("falls back to sane defaults when a token is undefined (never an empty/undefined value reaching mermaid)", () => {
    const vars = getMermaidThemeVariables();
    expect(vars.background).not.toBe("");
    expect(vars.primaryTextColor).not.toBe("");
    expect(vars.fontFamily).not.toBe("");
  });
});
