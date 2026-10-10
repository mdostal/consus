import { marked, type Token, type Tokens } from "marked";

/**
 * PANT-965: finds the ```mermaid fences in a markdown doc, in document
 * order — the same order marked's renderer visits them, which is what lets
 * DocRenderer's `code` renderer number its placeholders to match.
 */

export interface MermaidBlock {
  /** The diagram source inside the fence. */
  source: string;
  /** The fence exactly as written in the doc, including its markers. */
  raw: string;
  /** Character offset of `raw` in the doc, or -1 when it couldn't be found
   *  verbatim (e.g. a fence indented inside a list item). */
  offset: number;
  /** Whether replaceMermaidBlock can rewrite this block in place. */
  editable: boolean;
}

export function isMermaidLang(lang: string | undefined): boolean {
  return (lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() === "mermaid";
}

/** Where `source` starts inside `raw`, or -1 if it isn't there verbatim. */
function sourceOffsetInRaw(raw: string, source: string): number {
  if (source === "") {
    const firstNewline = raw.indexOf("\n");
    return firstNewline === -1 ? -1 : firstNewline + 1;
  }
  return raw.indexOf(source);
}

export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const codeTokens: Tokens.Code[] = [];
  marked.walkTokens(marked.lexer(markdown), (token: Token) => {
    if (token.type === "code" && isMermaidLang((token as Tokens.Code).lang)) {
      codeTokens.push(token as Tokens.Code);
    }
  });

  let cursor = 0;
  return codeTokens.map((token) => {
    const offset = markdown.indexOf(token.raw, cursor);
    if (offset !== -1) cursor = offset + token.raw.length;
    const editable = offset !== -1 && sourceOffsetInRaw(token.raw, token.text) !== -1;
    return { source: token.text, raw: token.raw, offset, editable };
  });
}

/**
 * The doc with block `index`'s diagram source swapped for `nextSource`,
 * fence markers and everything else untouched. Null when that block can't
 * be rewritten in place (see MermaidBlock.editable).
 */
export function replaceMermaidBlock(markdown: string, index: number, nextSource: string): string | null {
  const block = extractMermaidBlocks(markdown)[index];
  if (!block || !block.editable) return null;

  const start = sourceOffsetInRaw(block.raw, block.source);
  const replacement = block.source === "" ? `${nextSource}\n` : nextSource;
  const nextRaw = block.raw.slice(0, start) + replacement + block.raw.slice(start + block.source.length);
  return markdown.slice(0, block.offset) + nextRaw + markdown.slice(block.offset + block.raw.length);
}
