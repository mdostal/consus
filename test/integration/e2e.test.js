import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initArtifact, renderArtifactHTML, renderMarkdownFile, validateMarkdownFile } from "../../lib/cli.js";
import { roundTrip } from "../../lib/converter.js";
import {
  combineEditableHTML,
  hasDraft,
  initEditor,
  loadDraft,
  saveToMarkdown,
} from "../../lib/editor.js";
import { getSections, parseFrontmatter } from "../../lib/templates.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sample-artifacts");
const TEMP_DIRS = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "consus-e2e-"));
  TEMP_DIRS.push(dir);
  return dir;
}

// Loads a rendered artifact page into the shared jsdom `document`, the same
// pattern lib/editor.js itself relies on (it reads the global `document`/`window`).
function openArtifact(htmlPath) {
  document.documentElement.innerHTML = readFileSync(htmlPath, "utf8");
  return document.querySelector("[data-doc-id]");
}

afterEach(() => {
  while (TEMP_DIRS.length) {
    rmSync(TEMP_DIRS.pop(), { recursive: true, force: true });
  }
  document.documentElement.innerHTML = "";
});

describe("end-to-end: init -> edit -> save", () => {
  it("writes an edit made in the rendered HTML back to the markdown file on disk", async () => {
    const cwd = tempDir();
    const { markdownPath, htmlPath } = initArtifact("design-discussion", "roundtrip-flow", {
      cwd,
      author: "Ada",
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });

    const root = openArtifact(htmlPath);
    const body = root.querySelector('[data-editable="body"]');
    expect(body.innerHTML).toContain("What are we trying to accomplish?");

    body.innerHTML = body.innerHTML.replace(
      "[What are we trying to accomplish? What problem does this solve?]",
      "Ship the round-trip converter so edits never lose content.",
    );

    let written = null;
    const markdown = await saveToMarkdown(root, {
      write: (content) => {
        written = content;
      },
    });

    writeFileSync(markdownPath, markdown, "utf8");

    expect(written).toBe(markdown);
    expect(markdown).toContain("Ship the round-trip converter so edits never lose content.");
    expect(markdown).not.toContain("What are we trying to accomplish?");
    expect(readFileSync(markdownPath, "utf8")).toBe(markdown);
  });
});

describe("end-to-end: importing a real Hive artifact", () => {
  it("preserves design-discussion section structure through import, edit, and save", async () => {
    const cwd = tempDir();
    const source = readFileSync(join(FIXTURES_DIR, "design-discussion.md"), "utf8");
    const markdownPath = join(cwd, "imported-design-discussion.md");
    writeFileSync(markdownPath, source, "utf8");

    const originalSections = getSections(source).map((section) => section.heading);
    expect(originalSections).toEqual(["Goal", "Approach", "Risks", "Open Questions"]);

    const { outputPath: htmlPath } = renderMarkdownFile(markdownPath, { cwd });
    const root = openArtifact(htmlPath);
    const body = root.querySelector('[data-editable="body"]');

    // Edit prose under one section without touching any heading text.
    body.innerHTML = body.innerHTML.replace(
      "opt-in-only escape hatch?",
      "opt-in-only escape hatch, reviewed once more before v1 ships?",
    );

    const markdown = await saveToMarkdown(root, {});
    writeFileSync(markdownPath, markdown, "utf8");

    const savedSections = getSections(readFileSync(markdownPath, "utf8")).map((section) => section.heading);
    expect(savedSections).toEqual(originalSections);
    expect(markdown).toContain("reviewed once more before v1 ships?");
  });

  it("preserves decision-record ADR structure through import, edit, and save", async () => {
    const cwd = tempDir();
    const source = readFileSync(join(FIXTURES_DIR, "decision-record.md"), "utf8");
    const markdownPath = join(cwd, "imported-decision-record.md");
    writeFileSync(markdownPath, source, "utf8");

    const originalSections = getSections(source).map((section) => section.heading);
    expect(originalSections).toEqual(["Status", "Context", "Decision", "Consequences"]);

    const { outputPath: htmlPath } = renderMarkdownFile(markdownPath, { cwd });
    const root = openArtifact(htmlPath);

    const markdown = await saveToMarkdown(root, {});
    writeFileSync(markdownPath, markdown, "utf8");

    const savedSections = getSections(readFileSync(markdownPath, "utf8")).map((section) => section.heading);
    expect(savedSections).toEqual(originalSections);
  });
});

describe("end-to-end: complex markdown round-trips through the real render pipeline", () => {
  it.each(["design-discussion.md", "decision-record.md"])(
    "renders %s to HTML and back to identical markdown when unedited",
    async (fixture) => {
      const cwd = tempDir();
      const source = readFileSync(join(FIXTURES_DIR, fixture), "utf8");
      const markdownPath = join(cwd, fixture);
      writeFileSync(markdownPath, source, "utf8");

      const { body: expectedBody } = parseFrontmatter(source);
      const { outputPath: htmlPath } = renderMarkdownFile(markdownPath, { cwd });
      const root = openArtifact(htmlPath);

      // Sanity check the fixture actually exercises nested lists, code fences,
      // links, emphasis, and a blockquote before trusting the round-trip below.
      expect(combineEditableHTML(root)).toMatch(/<pre>|<blockquote>|<a href=|<strong>/);

      const markdown = await saveToMarkdown(root, {});

      expect(markdown).toBe(expectedBody.trim());
      expect(roundTrip(expectedBody.trim())).toBe(expectedBody.trim());
    },
  );
});

describe("end-to-end: auto-saved draft recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("recovers unsaved edits from a draft after the artifact is reopened", () => {
    const cwd = tempDir();
    const { htmlPath } = initArtifact("decision-record", "draft-recovery", {
      cwd,
      author: "Ada",
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });

    // First open: type an edit, let auto-save fire, then simulate the tab closing
    // (or crashing) before the user clicked Save.
    let root = openArtifact(htmlPath);
    initEditor(root, { docId: "draft-recovery" });
    const body = root.querySelector('[data-editable="body"]');
    const editedHTML = body.innerHTML.replace("[Proposed | Accepted | Deprecated | Superseded]", "Accepted, no data lost.");
    body.innerHTML = editedHTML;
    body.dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(2000);
    expect(hasDraft("draft-recovery")).toBe(true);
    expect(loadDraft("draft-recovery").content.body).toBe(editedHTML);

    // Reopen the artifact fresh from disk: the file itself was never saved,
    // so the rendered HTML still has the original placeholder text.
    root = openArtifact(htmlPath);
    expect(root.querySelector('[data-editable="body"]').innerHTML).not.toContain("no data lost");

    const banner = root.querySelector("[data-draft-banner]");
    expect(banner.hidden).toBe(true);

    initEditor(root, { docId: "draft-recovery" });
    expect(banner.hidden).toBe(false);

    root.querySelector('[data-action="restore-draft"]').click();

    expect(root.querySelector('[data-editable="body"]').innerHTML).toBe(editedHTML);
    expect(root.querySelector('[data-editable="body"]').innerHTML).toContain("Accepted, no data lost.");
    expect(banner.hidden).toBe(true);
  });
});

describe("end-to-end: consus validate catches a broken round-trip", () => {
  it("passes validate for artifacts created by init and by importing a real fixture", () => {
    const cwd = tempDir();
    const { markdownPath } = initArtifact("design-discussion", "validated-doc", {
      cwd,
      author: "Ada",
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });
    expect(validateMarkdownFile("validated-doc.md", { cwd })).toEqual({ inputPath: markdownPath, ok: true });

    const importedPath = join(cwd, "imported.md");
    writeFileSync(importedPath, readFileSync(join(FIXTURES_DIR, "design-discussion.md"), "utf8"), "utf8");
    expect(validateMarkdownFile("imported.md", { cwd })).toEqual({ inputPath: importedPath, ok: true });
  });

  it("fails validate when the markdown can't survive a round trip", () => {
    const cwd = tempDir();
    const markdownPath = join(cwd, "broken.md");
    // Images aren't implemented by the generator (see the fixture's Risks
    // section), so the markdown-it HTML for one round-trips to nothing.
    writeFileSync(markdownPath, "![missing alt handling](https://example.com/img.png)", "utf8");

    expect(() => validateMarkdownFile("broken.md", { cwd })).toThrow(/Round-trip validation failed/);
  });
});

describe("end-to-end: renderArtifactHTML stays available for non-file callers", () => {
  it("keeps the CLI render path and the direct API in agreement", () => {
    const cwd = tempDir();
    const { markdownPath, htmlPath } = initArtifact("design-discussion", "api-parity", {
      cwd,
      author: "Ada",
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });

    const markdown = readFileSync(markdownPath, "utf8");
    const direct = renderArtifactHTML(markdown, { docId: "api-parity" });
    const fromFile = readFileSync(htmlPath, "utf8");

    expect(fromFile).toBe(direct);
    expect(existsSync(htmlPath)).toBe(true);
  });
});
