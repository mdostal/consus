import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerDiagramRoutes } from "./diagrams.js";
import type { MulticaClient, MulticaEpic } from "../adapters/multica/client.js";

describe("GET /api/diagrams/cascade", () => {
  let root: string;
  let db: Database.Database;
  let app: FastifyInstance;
  let epicStatus: string;

  const epic = (): MulticaEpic => ({
    id: "epic-api-1",
    identifier: "s2-01",
    title: "Diagram Schema",
    description: null,
    status: epicStatus,
    priority: null,
    labels: [],
    updatedAt: `2026-08-10T00:00:00Z:${epicStatus}`,
    createdAt: null,
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "consus-diagram-route-"));
    const storyDir = join(root, ".pHive", "epics", "s2-01", "stories");
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(join(root, ".pHive", "epics", "s2-01", "epic.yaml"), "name: s2-01\ntitle: Diagram Schema\n");
    writeFileSync(join(storyDir, "schema-cache.yaml"), "id: schema-cache\ntitle: Cache helper\nstatus: done\n");
    db = new Database(":memory:");
    runMigration(db);
    epicStatus = "todo";
    const client = {
      listEpics: async () => ({ ok: true as const, epics: [epic()] }),
      listStories: async () => ({ ok: true as const, stories: [] }),
    } satisfies Pick<MulticaClient, "listEpics" | "listStories">;
    app = Fastify();
    registerDiagramRoutes(app, { db, client, pHiveRoot: root });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the live cascade Mermaid tree and stores it in the cache", async () => {
    const res = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cached).toBe(false);
    expect(body.diagram_type).toBe("cascade");
    expect(body.mermaid_source).toContain("graph TD");
    expect(body.mermaid_source).toContain("s2-01: Diagram Schema (todo)");
    expect(body.mermaid_source).toContain("schema-cache: Cache helper (done)");
  });

  it("returns the cached diagram when the source state fingerprint is unchanged", async () => {
    const first = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });
    const second = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });

    expect(first.json().cached).toBe(false);
    expect(second.json().cached).toBe(true);
    expect(second.json().mermaid_source).toBe(first.json().mermaid_source);
  });

  it("invalidates and refreshes the cached diagram when epic state changes", async () => {
    await app.inject({ method: "GET", url: "/api/diagrams/cascade" });
    epicStatus = "done";

    const refreshed = await app.inject({ method: "GET", url: "/api/diagrams/cascade" });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().cached).toBe(false);
    expect(refreshed.json().mermaid_source).toContain("s2-01: Diagram Schema (done)");
  });
});
