import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: true,
  breaks: true,
});

md.core.ruler.push('attributes', function(state) {
  for (let i = 0; i < state.tokens.length; i++) {
    const token = state.tokens[i];
    if (token.type === 'html_block') {
      const match = token.content.match(/^<!-- attrs:\s*({.*})\s*-->/);
      if (match) {
        try {
          const attrs = JSON.parse(match[1]);
          let nextToken = state.tokens[i + 1];
          if (nextToken) {
            for (const key of Object.keys(attrs)) {
              nextToken.attrSet(key, attrs[key]);
            }
          }
          state.tokens.splice(i, 1);
          i--;
        } catch (e) {}
      }
    } else if (token.type === 'inline') {
      let attrsToApply = null;
      for (let j = 0; j < token.children.length; j++) {
        const child = token.children[j];
        if (child.type === 'html_inline') {
          const match = child.content.match(/^<!-- attrs:\s*({.*})\s*-->/);
          if (match) {
            try {
              attrsToApply = JSON.parse(match[1]);
              token.children.splice(j, 1);
              j--;
            } catch (e) {}
          }
        } else if (attrsToApply && child.type.endsWith('_open')) {
          for (const key of Object.keys(attrsToApply)) {
            child.attrSet(key, attrsToApply[key]);
          }
          attrsToApply = null;
        }
      }
    }
  }
});

export function toHTML(markdown) {
  return md.render(markdown);
}
