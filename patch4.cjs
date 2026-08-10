const fs = require('fs');

let clientCode = fs.readFileSync('server/adapters/multica/client.ts', 'utf-8');
clientCode = clientCode.replace(
  'raw.comments || raw.data || raw.items || []',
  '(raw as any).comments || (raw as any).data || (raw as any).items || []'
);
fs.writeFileSync('server/adapters/multica/client.ts', clientCode);

let indexCode = fs.readFileSync('server/index.ts', 'utf-8');
indexCode = indexCode.replace(
  'async unblockIssue() {\n    return { ok: false, error: "Multica client not configured" };\n  },',
  'async unblockIssue() {\n    return { ok: false, error: "Multica client not configured" };\n  },\n  async getIssueComments() {\n    return { ok: false, error: "Multica client not configured" };\n  },\n  async getIssueChildren() {\n    return { ok: false, error: "Multica client not configured" };\n  },'
);
fs.writeFileSync('server/index.ts', indexCode);

let composeCode = fs.readFileSync('server/features/living-docs/compose.ts', 'utf-8');
composeCode = composeCode.replace(
  'if (client.getIssueComments) {',
  'if (true) {'
);
composeCode = composeCode.replace(
  'if (client.getIssueChildren) {',
  'if (true) {'
);
composeCode = composeCode.replace(
  'child.labels.some(l =>',
  'child.labels.some((l: string) =>'
);
composeCode = composeCode.replace(
  'child.labels.find(l =>',
  'child.labels.find((l: string) =>'
);
fs.writeFileSync('server/features/living-docs/compose.ts', composeCode);

