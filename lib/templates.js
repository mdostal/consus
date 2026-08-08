import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { markdownToHTML } from "./parser.js";

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "templates");

export const TEMPLATE_IDS = ["design-discussion", "decision-record"];

export function loadTemplate(id) {
  if (!TEMPLATE_IDS.includes(id)) {
    throw new Error(`Unknown template: ${id}`);
  }
  return readFileSync(join(TEMPLATES_DIR, `${id}.md`), "utf8");
}

export function parseFrontmatter(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return { frontmatter, body: markdown.slice(match[0].length) };
}

export function fillPlaceholders(markdown, values = {}) {
  return markdown.replace(/\{\{(\w+)\}\}/g, (token, key) => (key in values ? values[key] : token));
}

export function getSections(markdown) {
  const { body } = parseFrontmatter(markdown);
  const sections = [];
  let current = null;

  for (const line of body.split("\n")) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      current = { heading: heading[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    current?.lines.push(line);
  }

  return sections.map(({ heading, lines }) => ({
    heading,
    slug: slugify(heading),
    content: lines.join("\n").trim(),
  }));
}

function slugify(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function renderTemplateHTML(id, values = {}) {
  const filled = fillPlaceholders(loadTemplate(id), values);

  return getSections(filled)
    .map(({ slug, heading, content }) => {
      const sectionHTML = markdownToHTML(`## ${heading}\n\n${content}`);
      return `<section data-editable="${slug}">\n${sectionHTML}</section>`;
    })
    .join("\n");
}
