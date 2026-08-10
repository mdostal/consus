const fs = require('fs');
let code = fs.readFileSync('server/features/living-docs/compose.test.ts', 'utf-8');
code = code.replace(
  'import { composeLivingDoc } from "./compose.js";',
  'import { composeLivingDoc, composeEpicDocs } from "./compose.js";'
);
const newTest = `

describe("composeEpicDocs", () => {
  let repoDir: string;
  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo2-"));
    mkdirSync(join(repoDir, ".pHive", "epics", "epic-1", "docs"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "epics", "epic-1", "docs", "design-discussion.md"), "# disk design");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("merges Multica and disk docs with provenance", async () => {
    const mockClient = {
      getIssue: () => Promise.resolve({ ok: true, issue: { id: "epic-1", title: "Epic 1" } }),
      getIssueChildren: () => Promise.resolve({ ok: true, issues: [{ id: "story-1", title: "Story 1" }] }),
      getIssueComments: () => Promise.resolve({ ok: true, comments: [] })
    } as any;
    
    const docs = await composeEpicDocs("epic-1", mockClient, repoDir);
    expect(docs).not.toBeNull();
    if (docs) {
      expect(docs.find(d => d.type === "design-discussion")?.provenance).toBe("disk");
      expect(docs.find(d => d.type === "epic")?.provenance).toBe("multica");
      expect(docs.find(d => d.type === "story")?.provenance).toBe("multica");
    }
  });
});
`;
code += newTest;
fs.writeFileSync('server/features/living-docs/compose.test.ts', code);
