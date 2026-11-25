import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkProjectPath, existsInside, isWithin, realPathInside } from "./paths.js";

describe("isWithin", () => {
  it("accepts the root and paths below it, never a sibling sharing a prefix", () => {
    expect(isWithin("/repos/foo", "/repos/foo")).toBe(true);
    expect(isWithin("/repos/foo", "/repos/foo/a/b")).toBe(true);
    expect(isWithin("/repos/foo", "/repos/foobar")).toBe(false);
    expect(isWithin("/", "/anything")).toBe(true);
  });
});

describe("real-path containment and checkProjectPath", () => {
  let work: string;
  let roots: string;
  let secrets: string;

  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), "consus-paths-")));
    roots = join(work, "repos");
    secrets = join(work, "secrets");
    mkdirSync(join(roots, "a"), { recursive: true });
    mkdirSync(secrets);
    writeFileSync(join(secrets, "t.env"), "x");
    writeFileSync(join(roots, "a", "doc.md"), "x");
  });

  afterEach(() => rmSync(work, { recursive: true, force: true }));

  it("realPathInside follows symlinks on both sides", () => {
    symlinkSync(join(secrets, "t.env"), join(roots, "a", "out.md"));
    symlinkSync(join(roots, "a"), join(work, "alias"));
    expect(realPathInside(join(roots, "a"), join(roots, "a", "out.md"))).toBeNull();
    // A registered path that is itself a symlink still contains its own files.
    expect(realPathInside(join(work, "alias"), join(work, "alias", "doc.md"))).toBe(join(roots, "a", "doc.md"));
    expect(() => realPathInside(join(roots, "a"), join(roots, "a", "missing.md"))).toThrow(/ENOENT/);
    expect(existsInside(join(roots, "a"), join(roots, "a", "missing.md"))).toBe(false);
  });

  it("standalone (no allowed roots): any directory except the protected one, what's in it, or what contains it", () => {
    const policy = { protectedDirs: [secrets] };
    expect(checkProjectPath(join(roots, "a"), policy)).toEqual({ ok: true, path: join(roots, "a") });
    expect(checkProjectPath(secrets, policy)).toMatchObject({ ok: false, status: 403 });
    expect(checkProjectPath(work, policy)).toMatchObject({ ok: false, status: 403 });
    expect(checkProjectPath(join(work, "nope"), policy)).toMatchObject({ ok: false, status: 400 });
  });

  it("a protected dir that doesn't exist protects nothing", () => {
    expect(checkProjectPath(work, { protectedDirs: [join(work, "absent")] })).toMatchObject({ ok: true });
  });

  it("guarded: only inside the allowed roots, and nothing at all when there are none", () => {
    expect(checkProjectPath(join(roots, "a"), { protectedDirs: [secrets], allowedRoots: [roots] })).toMatchObject({ ok: true });
    expect(checkProjectPath(work, { protectedDirs: [], allowedRoots: [roots] })).toMatchObject({ ok: false, status: 403 });
    expect(checkProjectPath(join(roots, "a"), { protectedDirs: [], allowedRoots: [] })).toMatchObject({ ok: false, status: 403 });
  });

  it("returns the real path, so a symlink into the roots registers as its target", () => {
    symlinkSync(join(roots, "a"), join(roots, "link"));
    expect(checkProjectPath(join(roots, "link"), { protectedDirs: [], allowedRoots: [roots] })).toEqual({ ok: true, path: join(roots, "a") });
  });
});
