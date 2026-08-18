import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateArchitectureDiagrams } from "./diagram-generator.js";

const MERMAID_NODE_LINE = /^ {2}[a-zA-Z0-9_]+\["[^"]*"\]$/;
const MERMAID_EDGE_LINE = /^ {2}[a-zA-Z0-9_]+ --> [a-zA-Z0-9_]+(\["[^"]*"\])?$/;

function assertValidMermaid(source: string): void {
  const lines = source.split("\n");
  expect(lines[0]).toBe("graph TD");
  for (const line of lines.slice(1)) {
    expect(MERMAID_NODE_LINE.test(line) || MERMAID_EDGE_LINE.test(line)).toBe(true);
  }
}

describe("generateArchitectureDiagrams", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-diagram-repo-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("scans top-level repo directories (src/, lib/, etc.) into the top-level diagram", () => {
    mkdirSync(join(repoDir, "src"));
    mkdirSync(join(repoDir, "lib"));
    mkdirSync(join(repoDir, "node_modules"));
    mkdirSync(join(repoDir, ".git"));

    const { topLevel } = generateArchitectureDiagrams(repoDir);

    assertValidMermaid(topLevel);
    expect(topLevel).toContain('["src"]');
    expect(topLevel).toContain('["lib"]');
    expect(topLevel).not.toContain("node_modules");
    expect(topLevel).not.toMatch(/\.git/);
  });

  it("returns valid Mermaid syntax for both views", () => {
    mkdirSync(join(repoDir, "src", "components"), { recursive: true });
    writeFileSync(join(repoDir, "src", "index.ts"), "export {};");

    const { topLevel, fullComponent } = generateArchitectureDiagrams(repoDir);

    assertValidMermaid(topLevel);
    assertValidMermaid(fullComponent);
  });

  it("includes components mentioned in .pHive/epics/*/docs/design-discussion.md", () => {
    const docDir = join(repoDir, ".pHive", "epics", "some-epic", "docs");
    mkdirSync(docDir, { recursive: true });
    writeFileSync(
      join(docDir, "design-discussion.md"),
      "# Design\n\nReuses `server/adapters/multica/write-comment.ts` as-is.\n",
    );

    const { fullComponent } = generateArchitectureDiagrams(repoDir);

    assertValidMermaid(fullComponent);
    expect(fullComponent).toContain('["server/adapters/multica/write-comment.ts"]');
  });

  it("tolerates malformed design-discussion.md content without throwing", () => {
    const docDir = join(repoDir, ".pHive", "epics", "broken-epic", "docs");
    mkdirSync(docDir, { recursive: true });
    writeFileSync(join(docDir, "design-discussion.md"), "not `closed backtick and *** garbage {{{");

    expect(() => generateArchitectureDiagrams(repoDir)).not.toThrow();
  });

  it("returns an empty-ish full-component graph when there is no .pHive/epics directory", () => {
    expect(() => generateArchitectureDiagrams(repoDir)).not.toThrow();
    const { fullComponent } = generateArchitectureDiagrams(repoDir);
    assertValidMermaid(fullComponent);
  });

  it("caps generated components at 50 to avoid huge diagrams on large repos", () => {
    for (let i = 0; i < 80; i += 1) {
      mkdirSync(join(repoDir, `pkg-${i}`));
    }

    const { fullComponent } = generateArchitectureDiagrams(repoDir);

    const nodeCount = fullComponent.split("\n").filter((line) => MERMAID_NODE_LINE.test(line)).length;
    expect(nodeCount).toBeLessThanOrEqual(51);
  });
});
