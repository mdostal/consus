import { describe, it, expect } from 'vitest';
import { toHTML, toMarkdown } from '../lib/converter.js';

describe('Bidirectional Markdown-HTML Converter', () => {
  it('headers round-trip', () => {
    const md = '# Title\n\n## Subtitle';
    const html = toHTML(md);
    const result = toMarkdown(html);
    expect(result).toBe(md);
  });

  it('paragraphs and basic formatting', () => {
    const md = 'This is a **bold** and *italic* text with a [link](https://example.com).';
    const html = toHTML(md);
    // turndown escapes some things, let's just ensure it preserves semantic meaning or exact string
    const result = toMarkdown(html);
    expect(result.trim()).toBe(md);
  });

  it('lists round-trip', () => {
    const md = '- Item 1\n- Item 2\n  - Subitem A\n  - Subitem B\n- Item 3';
    const html = toHTML(md);
    const result = toMarkdown(html);
    expect(result.trim().replace(/ {3}/g, ' ')).toMatch(/- Item 1\n- Item 2\n  - Subitem A\n  - Subitem B\n- Item 3/);
  });

  it('code blocks round-trip', () => {
    const md = '```javascript\nconst a = 1;\n```';
    const html = toHTML(md);
    const result = toMarkdown(html);
    expect(result.trim()).toBe(md);
  });

  it('blockquotes round-trip', () => {
    const md = '> This is a blockquote\n>\n> Second line';
    const html = toHTML(md);
    const result = toMarkdown(html);
    expect(result.replace(/\n$/, '')).toContain('> This is a blockquote');
  });

  it('preserves attributes in block elements', () => {
    const md = '<!-- attrs: {"data-id":"123"} -->\n# Header with ID';
    const html = toHTML(md);
    expect(html).toContain('<h1 data-id="123">');
    const result = toMarkdown(html);
    expect(result.trim()).toBe(md);
  });

  it('preserves attributes in inline elements', () => {
    const md = 'Some <!-- attrs: {"class":"highlight"} -->**bold** text';
    const html = toHTML(md);
    expect(html).toContain('<strong class="highlight">bold</strong>');
    const result = toMarkdown(html);
    expect(result.trim()).toBe(md);
  });
});
