import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFormat,
  clearDraft,
  combineEditableHTML,
  extractContent,
  hasDraft,
  initEditableRegions,
  initEditor,
  loadDraft,
  restoreDraft,
  saveDraft,
  saveToMarkdown,
} from "../lib/editor.js";

function renderArtifact() {
  document.body.innerHTML = `
    <div data-doc-id="my-doc">
      <div class="consus-draft-banner" data-draft-banner hidden>
        <button type="button" data-action="restore-draft">Restore draft</button>
        <button type="button" data-action="discard-draft">Discard</button>
      </div>
      <button type="button" data-command="bold">Bold</button>
      <button type="button" data-command="italic">Italic</button>
      <button type="button" data-action="save">Save</button>
      <main data-editable="body"><p>Hello world</p></main>
    </div>
  `;
  return document.querySelector("[data-doc-id]");
}

function selectTextIn(el) {
  const textNode = el.firstChild.firstChild;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, textNode.length);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("initEditableRegions", () => {
  it("enables contenteditable on click-target regions", () => {
    const root = renderArtifact();
    initEditableRegions(root);

    expect(root.querySelector("[data-editable]").contentEditable).toBe("true");
  });
});

describe("applyFormat", () => {
  it("wraps the current selection in <strong> for bold", () => {
    const root = renderArtifact();
    const content = root.querySelector("[data-editable]");
    selectTextIn(content);

    const applied = applyFormat("bold", undefined);

    expect(applied).toBe(true);
    expect(content.innerHTML).toBe("<p><strong>Hello world</strong></p>");
  });

  it("wraps the current selection in <em> for italic", () => {
    const root = renderArtifact();
    const content = root.querySelector("[data-editable]");
    selectTextIn(content);

    applyFormat("italic", undefined);

    expect(content.innerHTML).toBe("<p><em>Hello world</em></p>");
  });

  it("wraps the current selection in a link with the given href", () => {
    const root = renderArtifact();
    const content = root.querySelector("[data-editable]");
    selectTextIn(content);

    applyFormat("link", "https://example.com");

    expect(content.innerHTML).toBe('<p><a href="https://example.com">Hello world</a></p>');
  });

  it("does nothing when there is no active selection", () => {
    renderArtifact();
    window.getSelection().removeAllRanges();

    expect(applyFormat("bold", undefined)).toBe(false);
  });
});

describe("auto-save to localStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a draft to localStorage 2 seconds after an edit", () => {
    const root = renderArtifact();
    const onSave = vi.fn();
    initEditor(root, { docId: "my-doc", onSave });

    const content = root.querySelector("[data-editable]");
    content.innerHTML = "<p>Hello edited world</p>";
    content.dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(1999);
    expect(hasDraft("my-doc")).toBe(false);

    vi.advanceTimersByTime(1);
    expect(hasDraft("my-doc")).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);

    const draft = loadDraft("my-doc");
    expect(draft.content.body).toBe("<p>Hello edited world</p>");
  });
});

describe("draft restore prompt", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the restore banner when a draft exists on load", () => {
    saveDraft("my-doc", { body: "<p>Recovered content</p>" });
    const root = renderArtifact();

    initEditor(root, { docId: "my-doc" });

    expect(root.querySelector("[data-draft-banner]").hidden).toBe(false);
  });

  it("does not show the restore banner when no draft exists", () => {
    const root = renderArtifact();

    initEditor(root, { docId: "my-doc" });

    expect(root.querySelector("[data-draft-banner]").hidden).toBe(true);
  });

  it("restores the draft content into the editable region on click", () => {
    saveDraft("my-doc", { body: "<p>Recovered content</p>" });
    const root = renderArtifact();
    initEditor(root, { docId: "my-doc" });

    root.querySelector('[data-action="restore-draft"]').click();

    expect(root.querySelector("[data-editable]").innerHTML).toBe("<p>Recovered content</p>");
    expect(root.querySelector("[data-draft-banner]").hidden).toBe(true);
  });

  it("discards the draft without touching content on click", () => {
    saveDraft("my-doc", { body: "<p>Recovered content</p>" });
    const root = renderArtifact();
    initEditor(root, { docId: "my-doc" });

    root.querySelector('[data-action="discard-draft"]').click();

    expect(root.querySelector("[data-editable]").innerHTML).toBe("<p>Hello world</p>");
    expect(hasDraft("my-doc")).toBe(false);
  });
});

describe("extractContent / combineEditableHTML", () => {
  it("collects innerHTML for every editable region keyed by its data-editable id", () => {
    const root = renderArtifact();

    expect(extractContent(root)).toEqual({ body: "<p>Hello world</p>" });
    expect(combineEditableHTML(root)).toBe("<p>Hello world</p>");
  });
});

describe("saveToMarkdown", () => {
  it("converts editable content to markdown via the converter and writes it out", async () => {
    const root = renderArtifact();
    const write = vi.fn();

    const markdown = await saveToMarkdown(root, { write });

    expect(markdown).toBe("Hello world");
    expect(write).toHaveBeenCalledWith("Hello world");
  });

  it("clears any pending draft once the save button converts and writes the file", async () => {
    window.localStorage.clear();
    saveDraft("my-doc", { body: "<p>Hello world</p>" });
    const root = renderArtifact();
    const write = vi.fn();
    const onSaveToMarkdown = vi.fn();
    initEditor(root, { docId: "my-doc", writeFile: write, onSaveToMarkdown });

    await root.querySelector('[data-action="save"]').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(write).toHaveBeenCalledWith("Hello world");
    expect(hasDraft("my-doc")).toBe(false);
  });
});

describe("clearDraft / restoreDraft direct usage", () => {
  it("returns false when restoring with no saved draft", () => {
    window.localStorage.clear();
    const root = renderArtifact();

    expect(restoreDraft("missing-doc", root)).toBe(false);
  });

  it("removes the stored draft", () => {
    window.localStorage.clear();
    saveDraft("my-doc", { body: "<p>x</p>" });
    clearDraft("my-doc");

    expect(hasDraft("my-doc")).toBe(false);
  });
});
