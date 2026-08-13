import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDiagramRoutes } from "./diagrams.js";

const EPIC_A_YAML = `
name: epic-a
title: "Epic A"
stories:
  - id: story-1
    title: "Story One"
    complexity: low
    depends_on: []
  - id: story-2
    title: "Story Two"
    complexity: medium
    depends_on: [story-1]
`;

const EPIC_B_YAML = `
name: epic-b
title: "Epic B"
stories:
  - id: story-3
    title: "Story Three"
    complexity: high
    depends_on: []
`;

describe("GET /api/diagrams", () => {
  let repoDir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-diagram-repo-"));
    mkdirSync(join(repoDir, ".pHive", "epics", "epic-a"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "epics", "epic-b"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "epics", "epic-a", "epic.yaml"), EPIC_A_YAML);
    writeFileSync(join(repoDir, ".pHive", "epics", "epic-b", "epic.yaml"), EPIC_B_YAML);

    app = Fastify();
    registerDiagramRoutes(app, { repos: { "test-repo": repoDir } });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns the epic/story tree for a configured repo", async () => {
    const res = await app.inject({ method: "GET", url: "/api/diagrams?repo=test-repo" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.repo).toBe("test-repo");
    expect(body.epics.map((e: { id: string }) => e.id).sort()).toEqual(["epic-a", "epic-b"]);
  });

  it("includes each story's id, title, complexity, and dependency edges", async () => {
    const res = await app.inject({ method: "GET", url: "/api/diagrams?repo=test-repo" });
    const body = res.json();
    const epicA = body.epics.find((e: { id: string }) => e.id === "epic-a");

    expect(epicA.title).toBe("Epic A");
    expect(epicA.stories).toEqual([
      { id: "story-1", title: "Story One", complexity: "low", dependsOn: [] },
      { id: "story-2", title: "Story Two", complexity: "medium", dependsOn: ["story-1"] },
    ]);
  });

  it("404s for an unconfigured repo rather than an empty/silent result", async () => {
    const res = await app.inject({ method: "GET", url: "/api/diagrams?repo=unknown-repo" });
    expect(res.statusCode).toBe(404);
  });

  it("400s when ?repo= is omitted", async () => {
    const res = await app.inject({ method: "GET", url: "/api/diagrams" });
    expect(res.statusCode).toBe(400);
  });

  it("returns an empty epics array (not an error) for a repo with no .pHive/epics yet", async () => {
    const emptyRepo = mkdtempSync(join(tmpdir(), "consus-diagram-empty-"));
    const emptyApp = Fastify();
    registerDiagramRoutes(emptyApp, { repos: { empty: emptyRepo } });
    await emptyApp.ready();

    const res = await emptyApp.inject({ method: "GET", url: "/api/diagrams?repo=empty" });
    expect(res.statusCode).toBe(200);
    expect(res.json().epics).toEqual([]);

    await emptyApp.close();
    rmSync(emptyRepo, { recursive: true, force: true });
  });
});
