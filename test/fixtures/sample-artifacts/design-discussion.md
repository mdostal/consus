---
title: Markdown/HTML Round-Trip Converter
type: design-discussion
author: Hive Planning
date: 2026-08-08
status: draft
---

# Design Discussion: Markdown/HTML Round-Trip Converter

## Goal

Consus artifacts are stored as markdown but edited as HTML in the browser. We need a converter that goes **markdown to HTML to markdown** without losing structure, so an artifact can be edited any number of times without drifting from its original form.

## Approach

Two independent passes, not a single bidirectional AST:

- `markdownToHTML` wraps [markdown-it](https://github.com/markdown-it/markdown-it) with `html: false` so untrusted input can't inject raw tags.
- `htmlToMarkdown` is a small custom generator that walks the editable DOM and re-emits markdown, because round-tripping through a second markdown library tends to normalize formatting in ways the original author didn't choose.

Supported constructs, checked with a fenced example:

```js
const html = toHTML(markdown);
const restored = toMarkdown(html);
```

- Alpha construct
  - Headings and paragraphs
  - Emphasis and links
- Beta construct
  1. Fenced code blocks with the language hint preserved
  2. Nested bullet and ordered lists

## Risks

- **Lossy round-trips on exotic input.** Tables and images aren't implemented yet; mitigation is to scope the v1 template set (design-discussion, decision-record) to constructs we've verified round-trip cleanly.
- **Editor-introduced HTML drift.** contentEditable can produce browser-specific markup (e.g. `<b>` instead of `<strong>`). Mitigation: the generator normalizes `b`/`strong` and `i`/`em` to the same markdown output.

> Round-trip fidelity is the whole point of the exercise: **if a save doesn't change the document, the file on disk shouldn't change either.**

## Open Questions

- Do we ever need `preserveAttributes` outside of debugging, or should it stay an opt-in-only escape hatch?
- Should validation (`consus validate`) run automatically on save, or stay a separate explicit command?
