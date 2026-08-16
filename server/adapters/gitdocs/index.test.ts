import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractDocCandidates, resolveInRepos } from "./index.js";

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
