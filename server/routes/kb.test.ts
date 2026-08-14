import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigration } from "../db/migrate.js";
import { registerKbRoutes } from "./kb.js";
import { createKbEntry, saveKbDraft } from "../kb/store.js";

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

  it("summarizes the comment thread into the write-back audit_log entry (REQ-25)", async () => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)",
    ).run("item-1", "alice", "does this need a follow-up?", now);
    db.prepare(
      "INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)",
    ).run("item-1", "bob", "no, ship it", now);

    const res = await app.inject({
      method: "POST",
      url: "/api/items/item-1/decide",
      payload: { actor: "mathew", newStatus: "approved" },
    });

    const body = res.json();
    expect(body.auditLog[0].chat_summary).toContain("2 messages");
    expect(body.auditLog[0].chat_summary).toContain("alice: does this need a follow-up?");
    expect(body.auditLog[0].chat_summary).toContain("bob: no, ship it");
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
});

describe("KB collections (kb-01)", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    createKbEntry(db, { id: "kb-general", title: "General entry", author: "mathew", content: "c" });
    createKbEntry(db, {
      id: "kb-marketing",
      title: "Marketing entry",
      author: "mathew",
      content: "c",
      collection: "marketing",
    });
    createKbEntry(db, {
      id: "kb-plans",
      title: "Plans entry",
      author: "mathew",
      content: "c",
      collection: "plans",
    });

    app = Fastify();
    registerKbRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("defaults new entries to the 'general' collection", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb-entries?collection=general" });
    const body = res.json();
    expect(body.map((e: { id: string }) => e.id)).toEqual(["kb-general"]);
  });

  it("filters entries by ?collection=", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb-entries?collection=marketing" });
    const body = res.json();
    expect(body.map((e: { id: string }) => e.id)).toEqual(["kb-marketing"]);
  });

  it("combines ?collection= with ?q= search scoping", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb-entries?collection=plans&q=Plans" });
    const body = res.json();
    expect(body.map((e: { id: string }) => e.id)).toEqual(["kb-plans"]);
  });

  it("returns every collection when ?collection= is omitted", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb-entries" });
    expect(res.json()).toHaveLength(3);
  });

  it("rejects an invalid ?collection= value with a 400, not a 500", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb-entries?collection=not-real" });
    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /api/kb-entries/:id/draft", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    createKbEntry(db, { id: "kb-1", title: "Adopt React Flow", author: "mathew", content: "published content" });

    app = Fastify();
    registerKbRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("persists a draft without publishing it", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/kb-entries/kb-1/draft",
      payload: { author: "mathew", content: "an in-progress edit" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.draft.content).toBe("an in-progress edit");
    expect(body.draft.state).toBe("draft");

    const drafts = await app.inject({ method: "GET", url: "/api/kb-entries/kb-1/drafts" });
    expect(drafts.json()).toHaveLength(1);
    expect(drafts.json()[0].content).toBe("an in-progress edit");

    // The published version is untouched — the draft never repoints
    // current_version_id.
    const versions = await app.inject({ method: "GET", url: "/api/kb-entries/kb-1/versions" });
    const published = versions.json().filter((v: { state: string }) => v.state === "published");
    expect(published).toHaveLength(1);
    expect(published[0].content).toBe("published content");
  });

  it("the draft route handler only calls saveKbDraft, never triggerApprovalPipeline (HTTP-layer isolation mirrors p11-02's module-layer isolation)", () => {
    const routesDir = dirname(fileURLToPath(import.meta.url));
    const routesSource = readFileSync(join(routesDir, "kb.ts"), "utf8");
    const draftRouteStart = routesSource.indexOf('"/api/kb-entries/:id/draft"');
    expect(draftRouteStart).toBeGreaterThan(-1);
    const nextRouteStart = routesSource.indexOf("app.", draftRouteStart + 1);
    const draftHandlerSource = routesSource.slice(
      draftRouteStart,
      nextRouteStart === -1 ? undefined : nextRouteStart,
    );
    expect(draftHandlerSource).toMatch(/saveKbDraft/);
    expect(draftHandlerSource).not.toMatch(/triggerApprovalPipeline/);
  });
});

describe("POST /api/kb-entries/:id/submit", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    createKbEntry(db, { id: "kb-1", title: "Adopt React Flow", author: "mathew", content: "published content" });

    app = Fastify();
    registerKbRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("promotes the latest draft to published when versionId is omitted", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/kb-entries/kb-1/draft",
      payload: { author: "mathew", content: "ready to submit" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/kb-entries/kb-1/submit",
      payload: { actor: "mathew" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.entryId).toBe("kb-1");
    expect(body.publishedVersionId).toBeDefined();
    expect(body.phases).toEqual({ approve: true, phaseSplit: true, kb: true });

    const versions = await app.inject({ method: "GET", url: "/api/kb-entries/kb-1/versions" });
    const published = versions.json().find((v: { id: number }) => v.id === body.publishedVersionId);
    expect(published.content).toBe("ready to submit");
    expect(published.state).toBe("published");
  });

  it("submits an explicit versionId instead of the latest draft", async () => {
    const draft1 = await app.inject({
      method: "PUT",
      url: "/api/kb-entries/kb-1/draft",
      payload: { author: "mathew", content: "first draft" },
    });
    await app.inject({
      method: "PUT",
      url: "/api/kb-entries/kb-1/draft",
      payload: { author: "mathew", content: "second draft" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/kb-entries/kb-1/submit",
      payload: { actor: "mathew", versionId: draft1.json().draft.id },
    });

    expect(res.statusCode).toBe(200);
    const versions = await app.inject({ method: "GET", url: "/api/kb-entries/kb-1/versions" });
    const published = versions.json().find((v: { id: number }) => v.id === res.json().publishedVersionId);
    expect(published.content).toBe("first draft");
  });

  it("404s when the entry has no draft to submit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kb-entries/kb-1/submit",
      payload: { actor: "mathew" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("404s for an unknown entry with an explicit versionId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kb-entries/does-not-exist/submit",
      payload: { actor: "mathew", versionId: 1 },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("draft content does not leak into ?q= search results (p11-03 search-leak fix)", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);

    app = Fastify();
    registerKbRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("does not return an entry that has no published version, only a matching draft", async () => {
    saveKbDraft(db, { id: "kb-draft-only", author: "mathew", content: "unique-draft-term-zzz" });

    const res = await app.inject({ method: "GET", url: "/api/kb-entries?q=unique-draft-term-zzz" });
    expect(res.json()).toEqual([]);
  });

  it("returns a published entry by its published content but not by a differing draft's content", async () => {
    createKbEntry(db, { id: "kb-1", title: "Adopt React Flow", author: "mathew", content: "published-term-abc" });
    saveKbDraft(db, { id: "kb-1", author: "mathew", content: "draft-only-term-xyz" });

    const byPublished = await app.inject({ method: "GET", url: "/api/kb-entries?q=published-term-abc" });
    expect(byPublished.json().map((e: { id: string }) => e.id)).toEqual(["kb-1"]);

    const byDraft = await app.inject({ method: "GET", url: "/api/kb-entries?q=draft-only-term-xyz" });
    expect(byDraft.json()).toEqual([]);
  });
});
