import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command } from "commander";
import open from "open";

import { roundTrip, toHTML } from "./converter.js";
import { fillPlaceholders, loadTemplate, parseFrontmatter } from "./templates.js";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(LIB_DIR, "..");
const ARTIFACT_TEMPLATE_PATH = join(PROJECT_ROOT, "templates", "artifact.html");
const EDITOR_MODULE_URL = pathToFileURL(join(LIB_DIR, "editor.js")).href;

export function createProgram(deps = {}) {
  const program = new Command();
  const log = deps.log ?? ((message) => console.log(message));

  program.name("consus").description("Create, edit, render, and validate Consus artifacts").version("0.3.0");

  program
    .command("init <template> <name>")
    .description("Create a markdown artifact and rendered HTML from a template")
    .option("-t, --title <title>", "document title")
    .option("-a, --author <author>", "document author")
    .option("-d, --date <date>", "document date")
    .option("-f, --force", "overwrite existing files")
    .action((template, name, options) => {
      const result = initArtifact(template, name, { ...deps, ...options });
      log(`Created ${formatPath(result.markdownPath, deps.cwd)} and ${formatPath(result.htmlPath, deps.cwd)}`);
    });

  program
    .command("render <file>")
    .description("Regenerate HTML from a markdown artifact")
    .option("-o, --output <file>", "HTML output path")
    .action((file, options) => {
      const result = renderMarkdownFile(file, { ...deps, ...options, force: true });
      log(`Rendered ${formatPath(result.outputPath, deps.cwd)}`);
    });

  program
    .command("edit <file>")
    .description("Render markdown to HTML and open it in the default browser")
    .option("-o, --output <file>", "HTML output path")
    .action(async (file, options) => {
      const result = await editMarkdownFile(file, { ...deps, ...options });
      log(`Opened ${formatPath(result.outputPath, deps.cwd)}`);
    });

  program
    .command("validate <file>")
    .description("Check markdown/html round-trip fidelity")
    .action((file) => {
      validateMarkdownFile(file, deps);
      log(`Validated ${formatPath(resolvePath(file, deps.cwd), deps.cwd)}`);
    });

  return program;
}

export function initArtifact(template, name, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const markdownPath = ensureExtension(resolvePath(name, cwd), ".md");
  const htmlPath = replaceExtension(markdownPath, ".html");
  const title = options.title ?? titleFromName(markdownPath);
  const author = options.author ?? process.env.USER ?? "unknown";
  const date = options.date ?? today(options.now);
  const markdown = fillPlaceholders(loadTemplate(template), {
    TITLE: title,
    AUTHOR: author,
    DATE: date,
  });

  assertWritable(markdownPath, options);
  assertWritable(htmlPath, options);
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, markdown, "utf8");

  const renderResult = renderMarkdownFile(markdownPath, { ...options, cwd, output: htmlPath, force: true });
  return { markdownPath, htmlPath: renderResult.outputPath };
}

export function renderMarkdownFile(file, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const inputPath = resolvePath(file, cwd);
  const outputPath = options.output ? resolvePath(options.output, cwd) : replaceExtension(inputPath, ".html");
  const markdown = readFileSync(inputPath, "utf8");
  const html = renderArtifactHTML(markdown, {
    docId: basename(inputPath, extname(inputPath)),
    editorModuleUrl: options.editorModuleUrl ?? EDITOR_MODULE_URL,
  });

  assertWritable(outputPath, options);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf8");
  return { inputPath, outputPath };
}

export async function editMarkdownFile(file, options = {}) {
  const result = renderMarkdownFile(file, { ...options, force: true });
  const opener = options.opener ?? open;
  await opener(pathToFileURL(result.outputPath).href, { wait: false });
  return result;
}

export function validateMarkdownFile(file, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const inputPath = resolvePath(file, cwd);
  const markdown = readFileSync(inputPath, "utf8");
  const { body } = parseFrontmatter(markdown);
  const expected = body.trim();
  const actual = roundTrip(expected);

  if (actual !== expected) {
    throw new Error(`Round-trip validation failed for ${formatPath(inputPath, cwd)}`);
  }

  return { inputPath, ok: true };
}

export function renderArtifactHTML(markdown, options = {}) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const title = frontmatter.title || findHeadingTitle(body) || titleFromName(options.docId ?? "artifact");
  const content = toHTML(body);
  const template = readFileSync(ARTIFACT_TEMPLATE_PATH, "utf8");

  return template
    .replaceAll("{{TITLE}}", escapeHTML(title))
    .replaceAll("{{DOC_ID}}", escapeHTML(options.docId ?? slugify(title)))
    .replace("{{CONTENT}}", content)
    .replace("../lib/editor.js", options.editorModuleUrl ?? EDITOR_MODULE_URL);
}

function resolvePath(file, cwd = process.cwd()) {
  return resolve(cwd, file);
}

function ensureExtension(file, extension) {
  return extname(file) ? file : `${file}${extension}`;
}

function replaceExtension(file, extension) {
  const current = extname(file);
  return current ? file.slice(0, -current.length) + extension : `${file}${extension}`;
}

function assertWritable(file, options) {
  if (!options.force && existsSync(file)) {
    throw new Error(`${file} already exists; pass --force to overwrite`);
  }
}

function titleFromName(file) {
  const stem = basename(file, extname(file));
  return stem
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function today(now = () => new Date()) {
  return now().toISOString().slice(0, 10);
}

function findHeadingTitle(markdown) {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match?.[1]?.trim();
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function escapeHTML(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatPath(file, cwd = process.cwd()) {
  const display = relative(cwd, file);
  return display && !display.startsWith("..") ? display : file;
}
