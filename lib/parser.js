import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

export function markdownToHTML(input, options = {}) {
  const source = options.beforeRender ? options.beforeRender(String(input ?? "")) : String(input ?? "");
  const html = markdown.render(source);
  return options.afterRender ? options.afterRender(html) : html;
}

export { markdown };
