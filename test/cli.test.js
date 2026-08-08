import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram, editMarkdownFile, initArtifact, renderMarkdownFile, validateMarkdownFile } from "../lib/cli.js";

const TEMP_DIRS = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "consus-cli-"));
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  while (TEMP_DIRS.length) {
    rmSync(TEMP_DIRS.pop(), { recursive: true, force: true });
  }
});

describe("consus CLI commands", () => {
  it("init creates markdown and HTML files from a named template", () => {
    const cwd = tempDir();

    const result = initArtifact("design-discussion", "my-doc", {
      cwd,
      author: "Ada",
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });

    expect(result.markdownPath).toBe(join(cwd, "my-doc.md"));
    expect(result.htmlPath).toBe(join(cwd, "my-doc.html"));
    expect(readFileSync(join(cwd, "my-doc.md"), "utf8")).toContain("type: design-discussion");
    expect(readFileSync(join(cwd, "my-doc.md"), "utf8")).toContain("title: My Doc");
    expect(readFileSync(join(cwd, "my-doc.html"), "utf8")).toContain("<h1>Design Discussion: My Doc</h1>");
  });

  it("render regenerates HTML from a markdown artifact", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "my-doc.md"), "# Updated Doc\n\nBody with **bold** text.", "utf8");

    const result = renderMarkdownFile("my-doc.md", { cwd });

    expect(result.outputPath).toBe(join(cwd, "my-doc.html"));
    expect(readFileSync(join(cwd, "my-doc.html"), "utf8")).toContain("<strong>bold</strong>");
  });

  it("edit renders HTML and opens it in the default browser", async () => {
    const cwd = tempDir();
    const opener = vi.fn();
    writeFileSync(join(cwd, "my-doc.md"), "# Editable Doc\n\nBody.", "utf8");

    await editMarkdownFile("my-doc.md", { cwd, opener });

    expect(existsSync(join(cwd, "my-doc.html"))).toBe(true);
    expect(opener).toHaveBeenCalledWith(expect.stringMatching(/^file:.*my-doc\.html$/), { wait: false });
  });

  it("validate passes when markdown survives round-trip conversion", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "my-doc.md"), "# Valid Doc\n\nParagraph with [a link](https://example.com).", "utf8");

    expect(validateMarkdownFile("my-doc.md", { cwd })).toEqual({ inputPath: join(cwd, "my-doc.md"), ok: true });
  });

  it("validate passes for markdown created by init", () => {
    const cwd = tempDir();
    initArtifact("design-discussion", "my-doc", {
      cwd,
      author: "Ada",
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });

    expect(validateMarkdownFile("my-doc.md", { cwd })).toEqual({ inputPath: join(cwd, "my-doc.md"), ok: true });
  });

  it("parses subcommands through the commander entry point", async () => {
    const cwd = tempDir();
    const logs = [];
    const program = createProgram({
      cwd,
      author: "Ada",
      now: () => new Date("2026-08-08T12:00:00.000Z"),
      log: (message) => logs.push(message),
    });

    await program.parseAsync(["init", "decision-record", "decision"], { from: "user" });

    expect(existsSync(join(cwd, "decision.md"))).toBe(true);
    expect(existsSync(join(cwd, "decision.html"))).toBe(true);
    expect(logs).toEqual(["Created decision.md and decision.html"]);
  });
});
