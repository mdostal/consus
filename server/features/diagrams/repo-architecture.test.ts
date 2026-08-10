import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import {
  buildRepoArchitectureGraph,
  renderArchitectureMermaid,
  docsFingerprint,
} from "./repo-architecture.js";

function writeEpicDocs(repoDir: string, epic: string, phase: string, fileName: string, content: string): void {
  const dir = join(repoDir, ".pHive", "epics", epic, phase);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), content);
}

describe("buildRepoArchitectureGraph", () => {
  let db: Database.Database;
  let repoDir: string;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-arch-"));
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns 5-10 major components at top level, one per epic found in .pHive docs", () => {
    const epics = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
    for (const epic of epics) {
      writeEpicDocs(repoDir, epic, "docs", "architecture.md", `# ${epic}`);
    }

    const graph = buildRepoArchitectureGraph({ db, repoName: "consus", repoPath: repoDir, level: "top" });

    expect(graph.components.length).toBeGreaterThanOrEqual(5);
    expect(graph.components.length).toBeLessThanOrEqual(10);
    expect(graph.components.map((c) => c.label).sort()).toEqual(epics.sort());
  });

  it("caps top-level components at 10 even when more epics are indexed", () => {
    const epics = Array.from({ length: 14 }, (_, i) => `epic-${i}`);
    for (const epic of epics) {
      writeEpicDocs(repoDir, epic, "docs", "architecture.md", `# ${epic}`);
    }

    const graph = buildRepoArchitectureGraph({ db, repoName: "consus", repoPath: repoDir, level: "top" });

    expect(graph.components.length).toBe(10);
  });

  it("returns all components and dependency edges at full level", () => {
    writeEpicDocs(repoDir, "alpha", "planning", "brief.md", "# brief");
    writeEpicDocs(repoDir, "alpha", "docs", "architecture.md", "# architecture");
    writeEpicDocs(repoDir, "bravo", "docs", "architecture.md", "# architecture");

    const graph = buildRepoArchitectureGraph({ db, repoName: "consus", repoPath: repoDir, level: "full" });

    // one component per (epic, phase) pair
    expect(graph.components.map((c) => c.label).sort()).toEqual([
      "alpha / docs",
      "alpha / planning",
      "bravo / docs",
    ]);
    // sequential phase edge within the alpha epic (planning -> docs)
    expect(graph.edges.length).toBeGreaterThan(0);
    const alphaPlanning = graph.components.find((c) => c.label === "alpha / planning")!;
    const alphaDocs = graph.components.find((c) => c.label === "alpha / docs")!;
    expect(graph.edges).toContainEqual({ from: alphaPlanning.id, to: alphaDocs.id });
  });

  it("falls back to a repo directory-structure scan when no .pHive docs are indexed", () => {
    mkdirSync(join(repoDir, "server"), { recursive: true });
    mkdirSync(join(repoDir, "client"), { recursive: true });
    mkdirSync(join(repoDir, "node_modules", "ignored"), { recursive: true });
    writeFileSync(join(repoDir, "server", "index.ts"), "export const x = 1;");
    writeFileSync(join(repoDir, "client", "app.tsx"), "export const y = 1;");

    const graph = buildRepoArchitectureGraph({ db, repoName: "consus", repoPath: repoDir, level: "top" });

    expect(graph.components.map((c) => c.label).sort()).toEqual(["client", "server"]);
  });
});

describe("renderArchitectureMermaid", () => {
  it("renders a graph TD diagram with components and edges", () => {
    const mermaid = renderArchitectureMermaid({
      components: [
        { id: "a", label: "Web Layer" },
        { id: "b", label: "API Layer" },
      ],
      edges: [{ from: "a", to: "b" }],
    });

    expect(mermaid.split("\n")[0]).toBe("graph TD");
    expect(mermaid).toContain('a["Web Layer"]');
    expect(mermaid).toContain('b["API Layer"]');
    expect(mermaid).toContain("a --> b");
  });
});

describe("docsFingerprint", () => {
  let db: Database.Database;
  let repoDir: string;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-fp-"));
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("changes when .pHive docs content changes and stays stable when unchanged", () => {
    writeEpicDocs(repoDir, "alpha", "docs", "architecture.md", "# v1");
    buildRepoArchitectureGraph({ db, repoName: "consus", repoPath: repoDir, level: "top" });
    const first = docsFingerprint(db, "consus");

    buildRepoArchitectureGraph({ db, repoName: "consus", repoPath: repoDir, level: "top" });
    const second = docsFingerprint(db, "consus");
    expect(second).toBe(first);

    writeEpicDocs(repoDir, "alpha", "docs", "architecture.md", "# v2 - changed");
    buildRepoArchitectureGraph({ db, repoName: "consus", repoPath: repoDir, level: "top" });
    const third = docsFingerprint(db, "consus");
    expect(third).not.toBe(first);
  });
});
