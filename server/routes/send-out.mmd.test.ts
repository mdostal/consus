import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigration } from "../db/migrate.js";
import { registerSendOutRoutes } from "./send-out.js";
import { NOOP_HARNESS_TRANSPORT } from "../harness/transport.js";

// PANT-965 x PANT-964: a standalone .mmd file exports as itself, and as a
// rendered diagram in the HTML export.
describe("GET /api/export/doc for a .mmd file", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let repoDir: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-mmd-export-"));
    writeFileSync(join(repoDir, "system.mmd"), "flowchart LR\n  api[API] --> db[Database]\n");
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerSendOutRoutes(app, { db, repos: { demo: repoDir }, transport: NOOP_HARNESS_TRANSPORT });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("downloads the source as text/plain under its own name", async () => {
    const res = await app.inject({ method: "GET", url: "/api/export/doc?repo=demo&path=system.mmd" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.headers["content-disposition"]).toContain('filename="system.mmd"');
    expect(res.body).toContain("api[API] --> db[Database]");
  });

  it("renders the diagram as inline SVG in the HTML export", async () => {
    const res = await app.inject({ method: "GET", url: "/api/export/doc?repo=demo&path=system.mmd&format=html" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<svg");
    expect(res.body).toContain("Database");
  });
});
