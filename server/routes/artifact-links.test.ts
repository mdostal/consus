import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerArtifactLinkRoutes } from "./artifact-links.js";

describe("Artifact Link Registry", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-1", "doc_ref", "Test item", "open", now, now);

    app = Fastify();
    registerArtifactLinkRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("associates a claude.ai Artifact URL with an item", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/items/item-1/artifact-links",
      payload: { url: "https://claude.ai/code/artifact/abc-123", label: "CBA" },
    });

    expect(res.statusCode).toBe(201);
  });

  it("lists linked artifacts for an item, reachable in one click (URL returned verbatim)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/items/item-1/artifact-links",
      payload: { url: "https://claude.ai/code/artifact/abc-123", label: "CBA" },
    });

    const res = await app.inject({ method: "GET", url: "/api/items/item-1/artifact-links" });
    const body = res.json();

    expect(body).toHaveLength(1);
    expect(body[0].url).toBe("https://claude.ai/code/artifact/abc-123");
    expect(body[0].label).toBe("CBA");
  });
});
