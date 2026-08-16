import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractDocCandidates, resolveInRepos, readGitDoc } from "./index.js";

describe("extractDocCandidates", () => {
  it("finds a path-like reference in prose", () => {
    const text = "see docs/architecture.md for details";
    expect(extractDocCandidates(text)).toContain("docs/architecture.md");
  });

  it("finds a .pHive-style nested path reference in prose", () => {
    const text = "the rationale is captured in .pHive/planning/bar.md, check it out";
    expect(extractDocCandidates(text)).toContain(".pHive/planning/bar.md");
  });

  it("excludes bare README.md mentions", () => {
    const text = "please update the README.md before merging";
    expect(extractDocCandidates(text)).not.toContain("README.md");
  });

  it("excludes bare CLAUDE.md mentions", () => {
    const text = "CLAUDE.md has the instructions";
    expect(extractDocCandidates(text)).not.toContain("CLAUDE.md");
  });

  it("still extracts README.md when it appears with a directory segment", () => {
    const text = "see docs/README.md for the overview";
    expect(extractDocCandidates(text)).toContain("docs/README.md");
  });

  it("returns an empty array for plain prose with no path-like substring", () => {
    const text = "This is just a normal sentence with no file references at all.";
    expect(extractDocCandidates(text)).toEqual([]);
  });

  it("returns an empty array for text containing only bare README.md/CLAUDE.md mentions", () => {
    const text = "Update README.md and CLAUDE.md before you open the PR.";
    expect(extractDocCandidates(text)).toEqual([]);
  });
});

describe("resolveInRepos", () => {
  let rootDir: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "consus-gitdocs-"));
    repoA = join(rootDir, "repo-a");
    repoB = join(rootDir, "repo-b");
    mkdirSync(join(repoA, "docs"), { recursive: true });
    mkdirSync(join(repoB, "docs"), { recursive: true });
    writeFileSync(join(repoA, "docs", "architecture.md"), "# Architecture (A)");
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("resolves to the repo that actually has the file, among several configured roots", () => {
    const result = resolveInRepos("docs/architecture.md", { a: repoA, b: repoB });
    expect(result).toEqual({ repo: "a", path: "docs/architecture.md" });
  });

  it("does not report a match for the repo that doesn't have the file", () => {
    // repoB alone should not resolve, since only repoA has the file.
    const result = resolveInRepos("docs/architecture.md", { b: repoB });
    expect(result).toBeNull();
  });

  it("returns null when the candidate exists under none of the configured repo roots", () => {
    const result = resolveInRepos("docs/nonexistent.md", { a: repoA, b: repoB });
    expect(result).toBeNull();
  });

  it("returns null for a path-traversal candidate rather than escaping the repo root", () => {
    // Sanity check the traversal target actually exists on disk outside the repos,
    // so a naive implementation really would find something if it escaped.
    writeFileSync(join(rootDir, "secret.md"), "top secret");
    const result = resolveInRepos("../secret.md", { a: repoA, b: repoB });
    expect(result).toBeNull();
  });

  it("returns null for a deep path-traversal candidate like ../../../etc/passwd", () => {
    const result = resolveInRepos("../../../etc/passwd", { a: repoA, b: repoB });
    expect(result).toBeNull();
  });

  it("returns null for an absolute-path candidate rather than escaping the repo root", () => {
    const outsideFile = join(rootDir, "outside.md");
    writeFileSync(outsideFile, "outside content");
    const result = resolveInRepos(outsideFile, { a: repoA, b: repoB });
    expect(result).toBeNull();
  });

  it("returns null without throwing for an empty repos map", () => {
    expect(resolveInRepos("docs/architecture.md", {})).toBeNull();
  });

  it("rejects a candidate that would resolve into a same-prefix sibling directory (naive startsWith guard)", () => {
    // repoRoot "foo" is a string-prefix of sibling "foobar" — a naive
    // startsWith(repoRoot) check (without the path.sep suffix) would
    // incorrectly admit a candidate meant for foobar when checked against foo.
    const fooRoot = join(rootDir, "foo");
    const foobarRoot = join(rootDir, "foobar");
    mkdirSync(fooRoot, { recursive: true });
    mkdirSync(foobarRoot, { recursive: true });
    writeFileSync(join(foobarRoot, "secret.md"), "sibling secret");

    // Candidate that, resolved against fooRoot, walks up and back down into
    // foobar/secret.md — must be rejected for the "foo" repo.
    const result = resolveInRepos("../foobar/secret.md", { foo: fooRoot });
    expect(result).toBeNull();
  });
});

describe("readGitDoc", () => {
  let repoDir: string;
  let firstCommitSha: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-gitdocs-readgitdoc-"));
    execFileSync("git", ["init"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

    writeFileSync(join(repoDir, "doc.md"), "# v1 (first commit)");
    execFileSync("git", ["add", "doc.md"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "v1"], { cwd: repoDir });
    firstCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();

    writeFileSync(join(repoDir, "doc.md"), "# v2 (second commit)");
    execFileSync("git", ["add", "doc.md"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "v2"], { cwd: repoDir });

    // Uncommitted working-tree change, distinct from both commits above, so
    // ref-aware reads and the working-tree read are provably different.
    writeFileSync(join(repoDir, "doc.md"), "# v3 (uncommitted working tree)");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns the content as it existed at the given ref, not the current working-tree content", () => {
    const result = readGitDoc(repoDir, "doc.md", firstCommitSha);
    expect(result.content).toContain("v1 (first commit)");
    expect(result.content).not.toContain("v3");
    expect(result.format).toBe("md");
  });

  it("returns the current working-tree content when no ref argument is given", () => {
    const result = readGitDoc(repoDir, "doc.md");
    expect(result.content).toContain("v3 (uncommitted working tree)");
    expect(result.format).toBe("md");
  });

  it("throws (rather than hanging or crashing the process) for an invalid/nonexistent ref", () => {
    expect(() => readGitDoc(repoDir, "doc.md", "not-a-real-ref")).toThrow();
  });

  it("does not let shell metacharacters in ref be interpreted by a shell (execFileSync argument-array safety)", () => {
    const markerFile = join(repoDir, "pwned");
    const maliciousRef = `; touch ${markerFile}`;

    // A shell-interpolated `git show "${ref}:${path}"` run via exec/execSync
    // would let this ref break out and run `touch pwned` as a second command.
    // execFileSync's argument-array form passes the whole string as a single
    // literal argv entry to git, so git show fails to find such a ref and no
    // shell ever gets a chance to split/interpret the `;`.
    expect(() => readGitDoc(repoDir, "doc.md", maliciousRef)).toThrow();
    expect(existsSync(markerFile)).toBe(false);
  });

  it("does not let command substitution in ref execute (execFileSync argument-array safety)", () => {
    const markerFile = join(repoDir, "pwned-subshell");
    const maliciousRef = `$(touch ${markerFile})`;

    expect(() => readGitDoc(repoDir, "doc.md", maliciousRef)).toThrow();
    expect(existsSync(markerFile)).toBe(false);
  });
});
