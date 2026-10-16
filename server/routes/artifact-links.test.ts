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

  describe("DELETE /api/items/:id/artifact-links/:linkId (PANT-937)", () => {
    async function addLink(itemId = "item-1") {
      await app.inject({
        method: "POST",
        url: `/api/items/${itemId}/artifact-links`,
        payload: { url: "https://claude.ai/code/artifact/dead", label: "Dead" },
      });
      const links = (await app.inject({ method: "GET", url: `/api/items/${itemId}/artifact-links` })).json();
      return links[links.length - 1].id as number;
    }

    it("removes the link and leaves an audit row with the removed link", async () => {
      const linkId = await addLink();
      const res = await app.inject({
        method: "DELETE",
        url: `/api/items/item-1/artifact-links/${linkId}`,
        payload: { actor: "pant-919" },
      });

      expect(res.statusCode).toBe(204);
      expect((await app.inject({ method: "GET", url: "/api/items/item-1/artifact-links" })).json()).toEqual([]);
      const audit = db.prepare("SELECT actor, field, old_value, new_value FROM audit_log WHERE item_id = 'item-1'").all();
      expect(audit).toEqual([
        {
          actor: "pant-919",
          field: "artifact_link",
          old_value: JSON.stringify({ id: linkId, url: "https://claude.ai/code/artifact/dead", label: "Dead" }),
          new_value: null,
        },
      ]);
    });

    it("accepts the actor as a query param", async () => {
      const linkId = await addLink();
      const res = await app.inject({ method: "DELETE", url: `/api/items/item-1/artifact-links/${linkId}?actor=agent` });
      expect(res.statusCode).toBe(204);
    });

    it("404s for an unknown link or a link on another item, and 400s without an actor", async () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("item-2", "doc_ref", "Other", "open", now, now);
      const linkId = await addLink();

      const del = (url: string, payload?: object) => app.inject({ method: "DELETE", url, payload });
      expect((await del(`/api/items/item-1/artifact-links/${linkId}`)).statusCode).toBe(400);
      expect((await del(`/api/items/item-2/artifact-links/${linkId}`, { actor: "a" })).statusCode).toBe(404);
      expect((await del("/api/items/item-1/artifact-links/999", { actor: "a" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/items/item-1/artifact-links" })).json()).toHaveLength(1);
    });
  });
});
