const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const BLOCK_TAGS = new Set(["blockquote", "div", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "ol", "p", "pre", "ul"]);

export function htmlToMarkdown(input, options = {}) {
  const source = options.beforeGenerate ? options.beforeGenerate(String(input ?? "")) : String(input ?? "");
  const root = parseHTML(source);
  const markdown = renderBlocks(root.children, { preserveAttributes: Boolean(options.preserveAttributes) }).trimEnd();
  return options.afterGenerate ? options.afterGenerate(markdown) : markdown;
}

function parseHTML(html) {
  const root = createElement("root", {});
  const stack = [root];
  const tokenPattern = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let token;

  while ((token = tokenPattern.exec(html)) !== null) {
    const value = token[0];
    const parent = stack[stack.length - 1];

    if (value.startsWith("<!--")) {
      parent.children.push({ type: "comment", value: value.slice(4, -3).trim() });
      continue;
    }

    if (value.startsWith("</")) {
      const tagName = value.slice(2, -1).trim().toLowerCase();
      while (stack.length > 1) {
        const current = stack.pop();
        if (current.tagName === tagName) {
          break;
        }
      }
      continue;
    }

    if (value.startsWith("<")) {
      const selfClosing = /\/\s*>$/.test(value);
      const tagContent = value.slice(1, value.length - (selfClosing ? 2 : 1)).trim();
      const spaceIndex = tagContent.search(/\s/);
      const tagName = (spaceIndex === -1 ? tagContent : tagContent.slice(0, spaceIndex)).toLowerCase();
      const attrs = parseAttributes(spaceIndex === -1 ? "" : tagContent.slice(spaceIndex + 1));
      const element = createElement(tagName, attrs);
      parent.children.push(element);

      if (!selfClosing && !VOID_TAGS.has(tagName)) {
        stack.push(element);
      }
      continue;
    }

    parent.children.push({ type: "text", value: decodeEntities(value) });
  }

  return root;
}

function createElement(tagName, attrs) {
  return { type: "element", tagName, attrs, children: [] };
}

function parseAttributes(input) {
  const attrs = {};
  const attrPattern = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;

  while ((match = attrPattern.exec(input)) !== null) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attrs;
}

function renderBlocks(nodes, context) {
  const blocks = [];

  for (const node of nodes) {
    const rendered = renderBlock(node, context);
    if (rendered) {
      blocks.push(rendered);
    }
  }

  return blocks.join("\n\n");
}

function renderBlock(node, context) {
  if (node.type === "text") {
    return node.value.trim();
  }

  if (node.type !== "element") {
    return "";
  }

  const attrComment = context.preserveAttributes ? renderAttributeComment(node) : "";

  if (/^h[1-6]$/.test(node.tagName)) {
    return appendAttributeComment(`${"#".repeat(Number(node.tagName[1]))} ${renderInline(node.children).trim()}`, attrComment);
  }

  if (node.tagName === "p") {
    return appendAttributeComment(renderInline(node.children).trim(), attrComment);
  }

  if (node.tagName === "blockquote") {
    const quote = renderBlocks(node.children, context)
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
    return appendAttributeComment(quote, attrComment);
  }

  if (node.tagName === "pre") {
    return appendAttributeComment(renderCodeBlock(node), attrComment);
  }

  if (node.tagName === "ul" || node.tagName === "ol") {
    return appendAttributeComment(renderList(node, 0, context), attrComment);
  }

  if (node.tagName === "hr") {
    return appendAttributeComment("---", attrComment);
  }

  return appendAttributeComment(renderBlocks(node.children, context) || renderInline(node.children).trim(), attrComment);
}

function renderCodeBlock(node) {
  const code = node.children.find((child) => child.type === "element" && child.tagName === "code");
  const attrs = code?.attrs ?? {};
  const language = languageFromClass(attrs.class ?? "");
  const text = textContent(code ? code.children : node.children).replace(/\n$/, "");
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

function languageFromClass(className) {
  const languageClass = className
    .split(/\s+/)
    .find((part) => part.startsWith("language-") || part.startsWith("lang-"));

  return languageClass ? languageClass.replace(/^(language-|lang-)/, "") : "";
}

function renderList(node, depth, context) {
  const ordered = node.tagName === "ol";
  const start = Number.parseInt(node.attrs.start ?? "1", 10);
  const items = node.children.filter((child) => child.type === "element" && child.tagName === "li");

  return items
    .map((item, index) => {
      const marker = ordered ? `${Number.isFinite(start) ? start + index : index + 1}.` : "-";
      return renderListItem(item, marker, depth, context);
    })
    .join("\n");
}

function renderListItem(node, marker, depth, context) {
  const indent = "  ".repeat(depth);
  const continuationIndent = `${indent}${" ".repeat(marker.length + 1)}`;
  const nestedLists = [];
  const ownBlocks = [];
  const inlineNodes = [];

  for (const child of node.children) {
    if (child.type === "element" && (child.tagName === "ul" || child.tagName === "ol")) {
      nestedLists.push(renderList(child, depth + 1, context));
      continue;
    }

    if (child.type === "element" && BLOCK_TAGS.has(child.tagName) && child.tagName !== "p") {
      const block = renderBlock(child, context);
      if (block) {
        ownBlocks.push(block);
      }
      continue;
    }

    inlineNodes.push(child);
  }

  const inlineText = renderInline(inlineNodes).trim();
  if (inlineText) {
    ownBlocks.unshift(inlineText);
  }

  const [firstBlock = "", ...restBlocks] = ownBlocks;
  const lines = [`${indent}${marker} ${firstBlock}`.trimEnd()];

  for (const block of restBlocks) {
    lines.push(
      ...block.split("\n").map((line) => `${continuationIndent}${line}`.trimEnd()),
    );
  }

  for (const nested of nestedLists) {
    lines.push(nested);
  }

  return lines.join("\n");
}

function renderInline(nodes) {
  return nodes.map(renderInlineNode).join("").replace(/[ \t]+\n/g, "\n");
}

function renderInlineNode(node) {
  if (node.type === "text") {
    return node.value.replace(/\n+/g, " ");
  }

  if (node.type !== "element") {
    return "";
  }

  const inner = renderInline(node.children);

  switch (node.tagName) {
    case "strong":
    case "b":
      return `**${inner}**`;
    case "em":
    case "i":
      return `*${inner}*`;
    case "a":
      return renderLink(node, inner);
    case "code":
      return renderInlineCode(inner);
    case "br":
      return "  \n";
    default:
      return inner;
  }
}

function renderLink(node, text) {
  const href = node.attrs.href ?? "";
  const title = node.attrs.title ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : "";
  return `[${text}](${href}${title})`;
}

function renderInlineCode(input) {
  const longestRun = Math.max(0, ...Array.from(input.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  const padding = input.startsWith("`") || input.endsWith("`") ? " " : "";
  return `${fence}${padding}${input}${padding}${fence}`;
}

function textContent(nodes) {
  return nodes.map((node) => (node.type === "text" ? node.value : textContent(node.children))).join("");
}

function renderAttributeComment(node) {
  const attrs = Object.entries(node.attrs).filter(([name]) => !(node.tagName === "a" && ["href", "title"].includes(name)));
  return attrs.length === 0 ? "" : `<!-- consus:attrs ${JSON.stringify({ tag: node.tagName, attrs: Object.fromEntries(attrs) })} -->`;
}

function appendAttributeComment(markdown, comment) {
  return comment ? `${markdown}\n${comment}` : markdown;
}

function decodeEntities(input) {
  return input
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
