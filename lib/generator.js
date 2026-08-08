import TurndownService from 'turndown';

// Configure Turndown with GFM-like settings
const ts = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*'
});

const ignoreAttrs = ['href', 'src', 'alt', 'title'];
const blockElements = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'DIV', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'TABLE', 'TR', 'TD', 'TH'
]);

for (const key of ts.rules.array) {
  const originalReplacement = key.replacement;
  key.replacement = function(content, node, options) {
    let result = originalReplacement.call(this, content, node, options);
    
    if (node.nodeType === 1 && node.attributes && node.attributes.length > 0) {
      let attrs = {};
      let hasAttrs = false;
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        if (!ignoreAttrs.includes(attr.name)) {
          attrs[attr.name] = attr.value;
          hasAttrs = true;
        }
      }
      if (hasAttrs && result.trim() !== '') {
        const match = result.match(/^([\s\S]*?)(\S[\s\S]*)$/);
        if (match) {
          const leading = match[1];
          const rest = match[2];
          const isBlock = blockElements.has(node.nodeName);
          const sep = isBlock ? '\n' : '';
          return leading + `<!-- attrs: ${JSON.stringify(attrs)} -->` + sep + rest;
        }
      }
    }
    return result;
  };
}

export function toMarkdown(html) {
  return ts.turndown(html);
}
