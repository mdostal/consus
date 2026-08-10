const fs = require('fs');
const file = 'server/adapters/multica/client.ts';
let code = fs.readFileSync(file, 'utf-8');

if (!code.includes('getIssueChildren')) {
  code = code.replace(
    'export interface MulticaClient {',
    `export interface MulticaListCommentsResult { ok: true; comments: { id: string; author: string; body: string; created_at: string }[] } | { ok: false; error: string };
export interface MulticaClient {
  getIssueComments(issueId: string): Promise<MulticaListCommentsResult>;
  getIssueChildren(issueId: string): Promise<MulticaListResult>;`
  );

  code = code.replace(
    'async writeComment',
    `async getIssueComments(issueId: string): Promise<MulticaListCommentsResult> {
    try {
      const response = await this.fetchJson(\`\${this.serverUrl}/issues/\${encodeURIComponent(issueId)}/comments\`, { method: "GET" });
      if (!response.ok) return { ok: false, error: \`HTTP \${response.status}\` };
      const raw = await response.json();
      return { ok: true, comments: Array.isArray(raw) ? raw : (raw.comments || raw.data || raw.items || []) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async getIssueChildren(issueId: string): Promise<MulticaListResult> {
    try {
      const response = await this.fetchJson(\`\${this.serverUrl}/issues/\${encodeURIComponent(issueId)}/children\`, { method: "GET" });
      if (!response.ok) return { ok: false, error: \`HTTP \${response.status}\` };
      const raw = unwrapIssues(await response.json());
      const issues = raw.map(normalizeIssue).filter((i): i is MulticaIssue => i !== null);
      return { ok: true, issues };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async writeComment`
  );
  fs.writeFileSync(file, code);
}
