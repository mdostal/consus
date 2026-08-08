import { htmlToMarkdown } from "./generator.js";
import { markdownToHTML } from "./parser.js";

export function toHTML(markdown, options = {}) {
  return markdownToHTML(markdown, options);
}

export function toMarkdown(html, options = {}) {
  return htmlToMarkdown(html, options);
}

export function roundTrip(markdown, options = {}) {
  return toMarkdown(toHTML(markdown, options), options);
}

export { htmlToMarkdown, markdownToHTML };
