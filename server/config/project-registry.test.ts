import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProjectRegistry, saveProjectRegistry } from "./project-registry.js";

describe("loadProjectRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "consus-registry-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults to a single 'consus' project mapped to cwd when no config file exists", () => {
    const registry = loadProjectRegistry(join(tmpDir, "does-not-exist.json"), "/some/cwd");

    expect(registry).toEqual({ consus: "/some/cwd" });
  });

  it("registers every project listed in a config file", () => {
    const projARoot = join(tmpDir, "proj-a");
    const projBRoot = join(tmpDir, "proj-b");
    mkdirSync(projARoot, { recursive: true });
    mkdirSync(projBRoot, { recursive: true });
    const configPath = join(tmpDir, "projects.json");
    writeFileSync(configPath, JSON.stringify({ "proj-a": projARoot, "proj-b": projBRoot }));

    const registry = loadProjectRegistry(configPath, "/some/cwd");

    expect(registry).toEqual({ "proj-a": projARoot, "proj-b": projBRoot });
  });

  it("skips a configured project whose path does not exist, with a warning, rather than crashing", () => {
    const projARoot = join(tmpDir, "proj-a");
    mkdirSync(projARoot, { recursive: true });
    const configPath = join(tmpDir, "projects.json");
    writeFileSync(
      configPath,
      JSON.stringify({ "proj-a": projARoot, "proj-missing": join(tmpDir, "does-not-exist") }),
    );

    const registry = loadProjectRegistry(configPath, "/some/cwd");

    expect(registry).toEqual({ "proj-a": projARoot });
  });

  it("exposes the registered project names via listProjects", async () => {
    const { listProjects } = await import("./project-registry.js");
    const registry = { "proj-a": "/a", "proj-b": "/b" };

    expect(listProjects(registry)).toEqual(["proj-a", "proj-b"]);
  });
});

describe("saveProjectRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "consus-registry-save-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a registry that loadProjectRegistry reads back unchanged", () => {
    const projARoot = join(tmpDir, "proj-a");
    mkdirSync(projARoot, { recursive: true });
    const configPath = join(tmpDir, "projects.json");

    saveProjectRegistry(configPath, { "proj-a": projARoot });

    expect(loadProjectRegistry(configPath, "/some/cwd")).toEqual({ "proj-a": projARoot });
  });
});
