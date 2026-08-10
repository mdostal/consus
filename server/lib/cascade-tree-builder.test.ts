import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyKind,
  buildMulticaForest,
  parseEpicYaml,
  findEpicYamlPaths,
  loadEpicFiles,
  mergeEpicFilesIntoForest,
  renderCascadeMermaid,
  buildCascadeTree,
  type CascadeIssue,
  type CascadeNode,
} from "./cascade-tree-builder.js";
import type { MulticaClient, MulticaIssue } from "../adapters/multica/client.js";

function issue(overrides: Partial<CascadeIssue> = {}): CascadeIssue {
  return {
    id: "issue-1",
    identifier: "PAN-1",
    title: "Some issue",
    status: "todo",
    parentId: null,
    ...overrides,
  };
}

describe("classifyKind", () => {
  it("classifies a seed-tagged title", () => {
    expect(classifyKind("SEED PLANNING EPIC: Auriga Tier-1")).toBe("seed");
  });

  it("classifies a meta-orchestrator title", () => {
    expect(classifyKind("Auriga — the meta-orchestrator")).toBe("meta-orchestrator");
    expect(classifyKind("Auriga meta orchestrator")).toBe("meta-orchestrator");
  });

  it("classifies a [slice-N] tagged epic title", () => {
    expect(classifyKind("[slice-2] Consus usable: cascade diagrams")).toBe("epic");
  });

  it("falls back to a generic issue kind", () => {
    expect(classifyKind("Fix the flaky test")).toBe("issue");
  });
});

describe("buildMulticaForest", () => {
  it("nests stories under their parent epic, epics under meta-orchestrator, meta-orchestrator under seed", () => {
    const issues: CascadeIssue[] = [
      issue({ id: "seed-1", title: "SEED PLANNING EPIC: Pantheon", parentId: null }),
      issue({ id: "meta-1", title: "Auriga meta-orchestrator", parentId: "seed-1" }),
      issue({ id: "epic-1", title: "[slice-2] Consus usable", parentId: "meta-1" }),
      issue({ id: "story-1", title: "Cascade org-tree diagram endpoint", identifier: "PAN-2", parentId: "epic-1" }),
      issue({ id: "story-2", title: "Diagram db schema", identifier: "PAN-3", parentId: "epic-1" }),
    ];

    const forest = buildMulticaForest(issues);

    expect(forest).toHaveLength(1);
    const seed = forest[0];
    expect(seed.kind).toBe("seed");
    expect(seed.children).toHaveLength(1);

    const meta = seed.children[0];
    expect(meta.kind).toBe("meta-orchestrator");
    expect(meta.children).toHaveLength(1);

    const epic = meta.children[0];
    expect(epic.kind).toBe("epic");
    expect(epic.children).toHaveLength(2);
    expect(epic.children.every((c) => c.kind === "story")).toBe(true);
    expect(epic.children.every((c) => c.source === "multica")).toBe(true);
  });

  it("treats an issue with no resolvable parent as a root", () => {
    const issues: CascadeIssue[] = [
      issue({ id: "a", title: "Orphan issue", parentId: "does-not-exist" }),
      issue({ id: "b", title: "Another root", parentId: null }),
    ];

    const forest = buildMulticaForest(issues);
    expect(forest.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("sorts children deterministically by label", () => {
    const issues: CascadeIssue[] = [
      issue({ id: "epic-1", title: "[slice-9] Some epic", parentId: null }),
      issue({ id: "z", title: "Zebra story", identifier: "PAN-9", parentId: "epic-1" }),
      issue({ id: "a", title: "Aardvark story", identifier: "PAN-8", parentId: "epic-1" }),
    ];

    const forest = buildMulticaForest(issues);
    expect(forest[0].children.map((c) => c.id)).toEqual(["a", "z"]);
  });
});

describe("parseEpicYaml", () => {
  it("parses name, title, and stories from a well-formed epic.yaml", () => {
    const raw = `
name: consus-v1-core-loop
title: "Consus v1 Core Loop"
stories:
  - id: story-01-server-skeleton
    title: "Server skeleton"
    complexity: low
    depends_on: []
  - id: story-02-doc-scanner
    title: "Doc scanner"
    complexity: medium
`;
    const parsed = parseEpicYaml(raw, "consus");
    expect(parsed).toEqual({
      repo: "consus",
      name: "consus-v1-core-loop",
      title: "Consus v1 Core Loop",
      updatedAt: "1970-01-01T00:00:00.000Z",
      stories: [
        { id: "story-01-server-skeleton", title: "Server skeleton" },
        { id: "story-02-doc-scanner", title: "Doc scanner" },
      ],
    });
  });

  it("returns null when the document has no name field", () => {
    expect(parseEpicYaml("title: Nameless\nstories: []\n", "consus")).toBeNull();
  });

  it("returns null on malformed YAML instead of throwing", () => {
    expect(parseEpicYaml("name: [unterminated\n  - broken", "consus")).toBeNull();
  });
});

describe("findEpicYamlPaths / loadEpicFiles", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-cascade-test-"));
    mkdirSync(join(repoDir, ".pHive", "epics", "sample-epic"), { recursive: true });
    writeFileSync(
      join(repoDir, ".pHive", "epics", "sample-epic", "epic.yaml"),
      "name: sample-epic\ntitle: Sample Epic\nstories:\n  - id: sample-story\n    title: Sample story\n",
    );
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("finds every epic.yaml under .pHive/epics", () => {
    const paths = findEpicYamlPaths(repoDir);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain(join(".pHive", "epics", "sample-epic", "epic.yaml"));
  });

  it("returns an empty list when the repo has no .pHive/epics directory", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "consus-cascade-empty-"));
    try {
      expect(findEpicYamlPaths(emptyDir)).toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("loads and parses epic.yaml files across a repo registry", () => {
    const files = loadEpicFiles({ sample: repoDir });
    expect(files).toEqual([
      { repo: "sample", name: "sample-epic", title: "Sample Epic", updatedAt: expect.any(String), stories: [{ id: "sample-story", title: "Sample story" }] },
    ]);
  });
});

describe("mergeEpicFilesIntoForest", () => {
  it("attaches an on-disk story not already present as a Multica sub-issue", () => {
    const epicNode: CascadeNode = {
      id: "epic-1",
      label: "[slice-2] Consus usable",
      kind: "epic",
      source: "multica",
      children: [],
    };

    const forest = mergeEpicFilesIntoForest([epicNode], [
      { repo: "consus", name: "slice-2", title: "Consus usable", stories: [{ id: "s2-04-extra-story", title: "Extra story only on disk" }] },
    ]);

    expect(forest[0].children).toHaveLength(1);
    expect(forest[0].children[0]).toMatchObject({ label: "Extra story only on disk", kind: "story", source: "phive" });
  });

  it("does not duplicate a story already represented as a Multica sub-issue", () => {
    const epicNode: CascadeNode = {
      id: "epic-1",
      label: "[slice-2] Consus usable",
      kind: "epic",
      source: "multica",
      children: [
        { id: "story-1", label: "PAN-2: s2-02-cascade-diagram-endpoint work", kind: "story", source: "multica", children: [] },
      ],
    };

    const forest = mergeEpicFilesIntoForest([epicNode], [
      { repo: "consus", name: "slice-2", title: "Consus usable", stories: [{ id: "s2-02-cascade-diagram-endpoint", title: "Cascade org-tree diagram endpoint" }] },
    ]);

    expect(forest[0].children).toHaveLength(1);
  });

  it("leaves the forest untouched when no epic.yaml matches the node", () => {
    const epicNode: CascadeNode = {
      id: "epic-1",
      label: "[slice-2] Consus usable",
      kind: "epic",
      source: "multica",
      children: [],
    };

    mergeEpicFilesIntoForest([epicNode], [
      { repo: "other", name: "unrelated-epic", title: "Unrelated", stories: [{ id: "x", title: "x" }] },
    ]);

    expect(epicNode.children).toHaveLength(0);
  });
});

describe("renderCascadeMermaid", () => {
  it("emits a valid graph LR header and edges for a nested forest", () => {
    const forest: CascadeNode[] = [
      {
        id: "epic-1",
        label: "[slice-2] Consus usable",
        kind: "epic",
        source: "multica",
        children: [
          { id: "story-1", label: 'PAN-2: cascade "diagram" endpoint', kind: "story", source: "multica", children: [] },
        ],
      },
    ];

    const mermaid = renderCascadeMermaid(forest);
    const lines = mermaid.split("\n");

    expect(lines[0]).toBe("graph LR");
    expect(mermaid).toContain("[slice-2] Consus usable");
    expect(mermaid).toContain("cascade &quot;diagram&quot; endpoint");
    expect(mermaid).toMatch(/-->/);
  });

  it("renders an empty forest as just the graph header", () => {
    expect(renderCascadeMermaid([])).toBe("graph LR");
  });
});

function makeMulticaIssue(overrides: Partial<MulticaIssue> = {}): MulticaIssue {
  return {
    id: "issue-1",
    identifier: "PAN-1",
    title: "Some issue",
    description: null,
    status: "todo",
    priority: "none",
    labels: [],
    updatedAt: null,
    createdAt: null,
    parentId: null,
    ...overrides,
  };
}

describe("buildCascadeTree", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-cascade-integration-"));
    mkdirSync(join(repoDir, ".pHive", "epics", "slice-2"), { recursive: true });
    writeFileSync(
      join(repoDir, ".pHive", "epics", "slice-2", "epic.yaml"),
      "name: slice-2\ntitle: Consus usable\nstories:\n  - id: s2-99-disk-only-story\n    title: Disk-only story\n",
    );
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("merges live Multica issues with on-disk epic.yaml stories into one forest", async () => {
    const client: MulticaClient = {
      async writeComment() {
        return { ok: false, error: "unused" };
      },
      async createIssue() {
        return { ok: false, error: "unused" };
      },
      async listIssues() {
        return {
          ok: true,
          issues: [
            makeMulticaIssue({ id: "epic-1", title: "[slice-2] Consus usable", parentId: null }),
            makeMulticaIssue({ id: "story-1", identifier: "PAN-2", title: "Cascade endpoint", parentId: "epic-1" }),
          ],
        };
      },
      async getIssue() {
        return { ok: false, error: "unused" };
      },
      async updateIssueStatus() {
        return { ok: false, error: "unused" };
      },
      async unblockIssue() {
        return { ok: false, error: "unused" };
      },
    };

    const result = await buildCascadeTree({ client, repos: { consus: repoDir } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forest).toHaveLength(1);
    const epic = result.forest[0];
    expect(epic.children.map((c) => c.label).sort()).toEqual(["Disk-only story", "PAN-2: Cascade endpoint"]);
  });

  it("surfaces the Multica error instead of throwing", async () => {
    const client: MulticaClient = {
      async writeComment() {
        return { ok: false, error: "unused" };
      },
      async createIssue() {
        return { ok: false, error: "unused" };
      },
      async listIssues() {
        return { ok: false, error: "Multica returned HTTP 503" };
      },
      async getIssue() {
        return { ok: false, error: "unused" };
      },
      async updateIssueStatus() {
        return { ok: false, error: "unused" };
      },
      async unblockIssue() {
        return { ok: false, error: "unused" };
      },
    };

    const result = await buildCascadeTree({ client, repos: {} });
    expect(result).toEqual({ ok: false, error: "Multica returned HTTP 503" });
  });
});
