import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerKbRoutes } from "./kb.js";
import { createKbEntry } from "../kb/store.js";

describe("POST /api/items/:id/decide", () => {
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
    registerKbRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("decides an item and returns the audit trail", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/items/item-1/decide",
      payload: { actor: "mathew", newStatus: "approved" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.item.status).toBe("approved");
    expect(body.auditLog).toHaveLength(1);
  });

  it("404s for an unknown item", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/items/does-not-exist/decide",
      payload: { actor: "mathew", newStatus: "approved" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("KB backlog — search/filter + direct edit (REQ-09, P1)", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    createKbEntry(db, { id: "kb-1", title: "Adopt React Flow", author: "mathew", content: "decision content about React Flow", sourceRepo: "consus" });
    createKbEntry(db, { id: "kb-2", title: "OTEL telemetry backend", author: "mathew", content: "decision content about OTEL", sourceRepo: "other-project" });

    app = Fastify();
    registerKbRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("filters/searches across ALL kb_entries, not just recently-decided ones", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb-entries?q=React" });
    const body = res.json();

    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("kb-1");
  });

  it("returns every kb_entry when no filter is given (the global cross-project case)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb-entries" });
    expect(res.json()).toHaveLength(2);
  });

  it("scopes to a single project via ?project=, excluding every other project's entries (REQ-27)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb-entries?project=consus" });
    const body = res.json();

    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("kb-1");
  });

  it("combines ?project= with ?q= search scoping", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb-entries?project=other-project&q=OTEL" });
    const body = res.json();

    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("kb-2");
  });

  it("edits a kb_entry directly (outside the comment/decide flow), versioned per REQ-08", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/kb-entries/kb-1",
      payload: { author: "mathew", content: "revised decision content" },
    });

    expect(res.statusCode).toBe(200);

    const versions = await app.inject({ method: "GET", url: "/api/kb-entries/kb-1/versions" });
    const versionBodies = versions.json();
    expect(versionBodies).toHaveLength(2);
    expect(versionBodies[1].content).toBe("revised decision content");
  });

  it("saves drafts as durable versions without changing the published current version", async () => {
    const before = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get("kb-1") as {
      current_version_id: number;
    };
    const longDraft = `draft start\n${"untruncated human edit ".repeat(4000)}\ndraft end`;

    const res = await app.inject({
      method: "PUT",
      url: "/api/kb-entries/kb-1/draft",
      payload: { author: "mathew", content: longDraft },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().currentVersionId).toBe(before.current_version_id);

    const versions = await app.inject({ method: "GET", url: "/api/kb-entries/kb-1/versions" });
    const versionBodies = versions.json();
    expect(versionBodies.map((v: { state: string }) => v.state)).toEqual(["published", "draft"]);
    expect(versionBodies[1].content).toBe(longDraft);
    expect(versionBodies[1].content.length).toBe(longDraft.length);
  });

  it("keeps draft-only text out of published KB search results", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/kb-entries/kb-1/draft",
      payload: { author: "mathew", content: "private-draft-token" },
    });

    const res = await app.inject({ method: "GET", url: "/api/kb-entries?q=private-draft-token" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });
});
