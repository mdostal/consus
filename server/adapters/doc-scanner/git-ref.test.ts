import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listFilesAtRef, readDocContentAtRef, diffDocAtRef, UnresolvableRefError, GitDocNotFoundError } from "./git-ref.js";

/** Thin wrapper so fixture setup reads like a sequence of git commands,
 *  mirroring the pattern already established in ./index.test.ts's sibling
 *  gitdocs/index.test.ts fixture. */
function git(repoDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf-8" });
}

describe("git-ref plumbing", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-git-ref-"));
    git(repoDir, ["init", "-b", "main"]);
    git(repoDir, ["config", "user.email", "test@example.com"]);
    git(repoDir, ["config", "user.name", "Test"]);

    // Initial commit on main: a doc that stays unchanged on the branch, and
    // one that gets modified on the branch (so diffDocAtRef has both a
    // null-diff and a non-null-diff case to exercise).
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "unchanged.md"), "# unchanged\n");
    writeFileSync(join(repoDir, ".pHive", "planning", "shared.md"), "# shared v1\n");
    // A file outside SCAN_ROOTS and a non-doc extension inside SCAN_ROOTS,
    // both of which must never show up in listFilesAtRef's output.
    writeFileSync(join(repoDir, "README.md"), "# not a scanned root\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "initial"]);

    git(repoDir, ["checkout", "-b", "feature/branch-doc"]);
    writeFileSync(join(repoDir, ".pHive", "planning", "foo.md"), "# foo on branch\n");
    writeFileSync(join(repoDir, ".pHive", "planning", "shared.md"), "# shared v2 (changed on branch)\n");
    writeFileSync(join(repoDir, ".pHive", "planning", "notes.txt"), "not a doc extension\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "branch changes"]);

    git(repoDir, ["checkout", "main"]);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  describe("listFilesAtRef", () => {
    it("includes a file that exists on the branch but not on main", () => {
      const branchFiles = listFilesAtRef(repoDir, "feature/branch-doc");
      expect(branchFiles).toContain(".pHive/planning/foo.md");
    });

    it("does not include that file when listing main", () => {
      const mainFiles = listFilesAtRef(repoDir, "main");
      expect(mainFiles).not.toContain(".pHive/planning/foo.md");
    });

    it("only returns files under SCAN_ROOTS with a DOC_EXTENSIONS extension (reusing the doc-scanner's constants)", () => {
      const branchFiles = listFilesAtRef(repoDir, "feature/branch-doc");
      expect(branchFiles).not.toContain("README.md");
      expect(branchFiles).not.toContain(".pHive/planning/notes.txt");
      expect(branchFiles).toContain(".pHive/planning/shared.md");
      expect(branchFiles).toContain(".pHive/planning/unchanged.md");
    });

    it("throws UnresolvableRefError for a ref that does not resolve locally", () => {
      expect(() => listFilesAtRef(repoDir, "no-such-branch")).toThrow(UnresolvableRefError);
    });

    it("does not let shell metacharacters in ref be interpreted by a shell", () => {
      const markerFile = join(repoDir, "pwned-list");
      const maliciousRef = `; touch ${markerFile}`;
      expect(() => listFilesAtRef(repoDir, maliciousRef)).toThrow(UnresolvableRefError);
      expect(existsSync(markerFile)).toBe(false);
    });

    it("does not let command substitution in ref execute", () => {
      const markerFile = join(repoDir, "pwned-list-subshell");
      const maliciousRef = `$(touch ${markerFile})`;
      expect(() => listFilesAtRef(repoDir, maliciousRef)).toThrow(UnresolvableRefError);
      expect(existsSync(markerFile)).toBe(false);
    });
  });

  describe("readDocContentAtRef", () => {
    it("returns exactly the file's content at that ref, byte-identical to `git show <ref>:<path>` run directly", () => {
      const expected = git(repoDir, ["show", "feature/branch-doc:.pHive/planning/foo.md"]);
      const actual = readDocContentAtRef(repoDir, "feature/branch-doc", ".pHive/planning/foo.md");
      expect(actual).toBe(expected);
    });

    it("throws UnresolvableRefError for a ref that does not resolve locally", () => {
      expect(() => readDocContentAtRef(repoDir, "no-such-branch", ".pHive/planning/foo.md")).toThrow(
        UnresolvableRefError,
      );
    });

    it("does not let shell metacharacters in ref be interpreted by a shell", () => {
      const markerFile = join(repoDir, "pwned-read");
      const maliciousRef = `; touch ${markerFile}`;
      expect(() => readDocContentAtRef(repoDir, maliciousRef, ".pHive/planning/foo.md")).toThrow(
        UnresolvableRefError,
      );
      expect(existsSync(markerFile)).toBe(false);
    });

    it("does not let shell metacharacters in filePath be interpreted by a shell", () => {
      const markerFile = join(repoDir, "pwned-read-path");
      const maliciousPath = `; touch ${markerFile}`;
      expect(() => readDocContentAtRef(repoDir, "main", maliciousPath)).toThrow();
      expect(existsSync(markerFile)).toBe(false);
    });

    it("throws a distinguishable, non-UnresolvableRefError error when the ref resolves but the file does not exist at that ref", () => {
      let caught: unknown;
      try {
        readDocContentAtRef(repoDir, "main", ".pHive/planning/does-not-exist.md");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GitDocNotFoundError);
      expect(caught).not.toBeInstanceOf(UnresolvableRefError);
    });
  });

  describe("diffDocAtRef", () => {
    it("returns a non-null unified diff string for a doc that differs between branch and main", () => {
      const diff = diffDocAtRef(repoDir, "feature/branch-doc", "main", ".pHive/planning/shared.md");
      expect(diff).not.toBeNull();
      expect(diff).toContain("shared v2");
    });

    it("returns null for a doc that is identical on both branch and main", () => {
      const diff = diffDocAtRef(repoDir, "feature/branch-doc", "main", ".pHive/planning/unchanged.md");
      expect(diff).toBeNull();
    });

    it("throws UnresolvableRefError for a ref that does not resolve locally", () => {
      expect(() =>
        diffDocAtRef(repoDir, "no-such-branch", "main", ".pHive/planning/shared.md"),
      ).toThrow(UnresolvableRefError);
    });

    it("throws UnresolvableRefError for a base that does not resolve locally", () => {
      expect(() =>
        diffDocAtRef(repoDir, "feature/branch-doc", "no-such-base", ".pHive/planning/shared.md"),
      ).toThrow(UnresolvableRefError);
    });

    it("does not let shell metacharacters in base be interpreted by a shell", () => {
      const markerFile = join(repoDir, "pwned-diff");
      const maliciousBase = `; touch ${markerFile}`;
      expect(() =>
        diffDocAtRef(repoDir, "feature/branch-doc", maliciousBase, ".pHive/planning/shared.md"),
      ).toThrow(UnresolvableRefError);
      expect(existsSync(markerFile)).toBe(false);
    });

    it("does not let command substitution in ref execute", () => {
      const markerFile = join(repoDir, "pwned-diff-subshell");
      const maliciousRef = `$(touch ${markerFile})`;
      expect(() => diffDocAtRef(repoDir, maliciousRef, "main", ".pHive/planning/shared.md")).toThrow(
        UnresolvableRefError,
      );
      expect(existsSync(markerFile)).toBe(false);
    });
  });
});
