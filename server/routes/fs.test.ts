import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerFsRoutes } from "./fs.js";

describe("GET /api/fs/list", () => {
  let rootDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), "consus-fs-list-"));

    // plain subdirectory — not a repo
    mkdirSync(join(rootDir, "plain-dir"));

    // subdirectory that's a git repo
    mkdirSync(join(rootDir, "git-repo"));
    mkdirSync(join(rootDir, "git-repo", ".git"));

    // subdirectory that's a pHive-managed repo
    mkdirSync(join(rootDir, "phive-repo"));
    mkdirSync(join(rootDir, "phive-repo", ".pHive"));

    // a regular file alongside the subdirectories — must never be listed
    writeFileSync(join(rootDir, "a-file.txt"), "not a directory");

    app = Fastify();
    registerFsRoutes(app, {});
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("lists only the immediate subdirectories, never files, one level deep", async () => {
    const res = await app.inject({ method: "GET", url: `/api/fs/list?path=${encodeURIComponent(rootDir)}` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.entries.map((e: { name: string }) => e.name).sort();
    expect(names).toEqual(["git-repo", "phive-repo", "plain-dir"]);
  });

  it("flags isRepo true for a subdirectory containing .git, false for one containing neither", async () => {
    const res = await app.inject({ method: "GET", url: `/api/fs/list?path=${encodeURIComponent(rootDir)}` });
    const byName = Object.fromEntries(res.json().entries.map((e: { name: string; isRepo: boolean }) => [e.name, e]));

    expect(byName["git-repo"].isRepo).toBe(true);
    expect(byName["git-repo"].path).toBe(join(rootDir, "git-repo"));
    expect(byName["plain-dir"].isRepo).toBe(false);
  });

  it("flags isRepo true for a subdirectory containing .pHive", async () => {
    const res = await app.inject({ method: "GET", url: `/api/fs/list?path=${encodeURIComponent(rootDir)}` });
    const byName = Object.fromEntries(res.json().entries.map((e: { name: string; isRepo: boolean }) => [e.name, e]));

    expect(byName["phive-repo"].isRepo).toBe(true);
  });

  it("rejects a path that does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/fs/list?path=${encodeURIComponent(join(rootDir, "does-not-exist"))}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/does not exist/);
  });

  it("rejects a path that is not a directory", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/fs/list?path=${encodeURIComponent(join(rootDir, "a-file.txt"))}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not a directory/);
  });

  it("rejects a path containing .. segments without ever resolving it", async () => {
    // built as a literal string (not via path.join, which would normalize
    // the ".." away before it ever reached the route) so the raw query
    // value genuinely still contains a ".." segment.
    const traversalPath = `${rootDir}/plain-dir/../git-repo`;
    const res = await app.inject({
      method: "GET",
      url: `/api/fs/list?path=${encodeURIComponent(traversalPath)}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/\.\./);
  });

  it("silently omits a subdirectory entry that cannot be stat'd (broken symlink) and still lists the rest", async () => {
    symlinkSync(join(rootDir, "does-not-exist-target"), join(rootDir, "broken-link"));

    const res = await app.inject({ method: "GET", url: `/api/fs/list?path=${encodeURIComponent(rootDir)}` });

    expect(res.statusCode).toBe(200);
    const names = res.json().entries.map((e: { name: string }) => e.name);
    expect(names).not.toContain("broken-link");
    expect(names.sort()).toEqual(["git-repo", "phive-repo", "plain-dir"]);
  });
});

describe("GET /api/fs/list — default path", () => {
  let homeDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "consus-fs-home-"));
    mkdirSync(join(homeDir, "projects"));

    app = Fastify();
    registerFsRoutes(app, { homeDir });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("defaults to the OS home directory when no path query param is given", async () => {
    const res = await app.inject({ method: "GET", url: "/api/fs/list" });

    expect(res.statusCode).toBe(200);
    const names = res.json().entries.map((e: { name: string }) => e.name);
    expect(names).toEqual(["projects"]);
  });
});
