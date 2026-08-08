// generator.js has no external deps, unlike converter.js (pulls in markdown-it via parser.js),
// so importing it directly keeps this module loadable by an unbundled browser <script type="module">.
import { htmlToMarkdown } from "./generator.js";

const FORMAT_TAGS = { bold: "strong", italic: "em", link: "a" };

export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function initEditableRegions(root = document) {
  const regions = Array.from(root.querySelectorAll("[data-editable]"));
  regions.forEach((el) => {
    el.contentEditable = "true";
  });
  return regions;
}

export function applyFormat(command, value) {
  const tagName = FORMAT_TAGS[command];
  if (!tagName) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const wrapper = document.createElement(tagName);
  if (tagName === "a") {
    wrapper.setAttribute("href", value ?? "");
  }
  wrapper.appendChild(range.extractContents());
  range.insertNode(wrapper);

  selection.removeAllRanges();
  const collapsed = document.createRange();
  collapsed.selectNodeContents(wrapper);
  selection.addRange(collapsed);

  return true;
}

export function extractContent(root = document) {
  const content = {};
  root.querySelectorAll("[data-editable]").forEach((el) => {
    content[el.dataset.editable] = el.innerHTML;
  });
  return content;
}

export function combineEditableHTML(root = document) {
  return Array.from(root.querySelectorAll("[data-editable]"))
    .map((el) => el.innerHTML)
    .join("\n");
}

export function draftKey(docId) {
  return `consus-draft-${docId}`;
}

export function saveDraft(docId, content, storage = window.localStorage) {
  storage.setItem(draftKey(docId), JSON.stringify({ content, savedAt: new Date().toISOString() }));
}

export function loadDraft(docId, storage = window.localStorage) {
  const raw = storage.getItem(draftKey(docId));
  return raw ? JSON.parse(raw) : null;
}

export function hasDraft(docId, storage = window.localStorage) {
  return storage.getItem(draftKey(docId)) !== null;
}

export function clearDraft(docId, storage = window.localStorage) {
  storage.removeItem(draftKey(docId));
}

export function restoreDraft(docId, root = document, storage = window.localStorage) {
  const draft = loadDraft(docId, storage);
  if (!draft) {
    return false;
  }

  for (const [key, html] of Object.entries(draft.content)) {
    const el = root.querySelector(`[data-editable="${key}"]`);
    if (el) {
      el.innerHTML = html;
    }
  }

  return true;
}

export function bindAutoSave(root, docId, options = {}) {
  const { wait = 2000, storage = window.localStorage, onSave } = options;
  const trigger = debounce(() => {
    saveDraft(docId, extractContent(root), storage);
    onSave?.();
  }, wait);

  root.querySelectorAll("[data-editable]").forEach((el) => {
    el.addEventListener("input", trigger);
  });

  return trigger;
}

export async function saveToMarkdown(root, options = {}) {
  const { convert = htmlToMarkdown, write } = options;
  const markdown = convert(combineEditableHTML(root));
  if (write) {
    await write(markdown);
  }
  return markdown;
}

export function initEditor(root, options = {}) {
  const {
    docId,
    storage = window.localStorage,
    autoSaveWait = 2000,
    onSave,
    onSaveToMarkdown,
    writeFile,
    convert,
  } = options;

  initEditableRegions(root);

  const banner = root.querySelector("[data-draft-banner]");
  if (banner && hasDraft(docId, storage)) {
    banner.hidden = false;
    banner.querySelector('[data-action="restore-draft"]')?.addEventListener("click", () => {
      restoreDraft(docId, root, storage);
      banner.hidden = true;
    });
    banner.querySelector('[data-action="discard-draft"]')?.addEventListener("click", () => {
      clearDraft(docId, storage);
      banner.hidden = true;
    });
  }

  root.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.command;
      const value = command === "link" ? window.prompt("URL") : undefined;
      if (command === "link" && !value) {
        return;
      }
      applyFormat(command, value);
    });
  });

  const autoSaveTrigger = bindAutoSave(root, docId, { wait: autoSaveWait, storage, onSave });

  const saveButton = root.querySelector('[data-action="save"]');
  saveButton?.addEventListener("click", async () => {
    const markdown = await saveToMarkdown(root, { convert, write: writeFile });
    clearDraft(docId, storage);
    onSaveToMarkdown?.(markdown);
  });

  return { autoSaveTrigger };
}
