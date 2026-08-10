import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerEpicsRoutes } from "./epics.js";
import type { MulticaClient } from "../adapters/multica/client.js";

describe("GET /api/epics/:epic_id/docs", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    
    const mockClient = {
      getIssue: vi.fn().mockResolvedValue({
        ok: true,
        issue: {
          id: "epic-2",
          title: "Epic 2",
          description: "Epic description",
          status: "in_progress",
          labels: [],
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }
      }),
      listIssues: vi.fn().mockResolvedValue({
        ok: true,
        issues: []
      }),
      listComments: vi.fn().mockResolvedValue({
        ok: true,
        comments: []
      })
    } as unknown as MulticaClient;

    registerEpicsRoutes(app, { db, client: mockClient, repos: { "consus": "/tmp/non-existent-repo" } });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("returns 200 with epic docs view", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/epics/epic-2/docs"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.docs["epic-description"].content).toBe("Epic description");
    expect(body.stories).toEqual([]);
  });
});
