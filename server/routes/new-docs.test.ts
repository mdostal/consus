import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigration } from "../db/migrate.js";
import { registerNewDocRoutes } from "./new-docs.js";
import type { HarnessTransport, HarnessResult } from "../harness/transport.js";

function recordingTransport(calls: Array<{ method: string; params: unknown }>): HarnessTransport {
  return {
    async invoke<T>(method: string, params?: unknown) {
      calls.push({ method, params });
      return { ok: true, result: {} } as HarnessResult<T>;
    },
  };
}

describe("new-file proposals (PANT-965)", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let repoDir: string;
  let calls: Array<{ method: string; params: unknown }>;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-new-docs-"));
    writeFileSync(join(repoDir, "README.md"), "# Readme\n");
    db = new Database(":memory:");
    runMigration(db);
    calls = [];
    app = Fastify();
    registerNewDocRoutes(app, { db, repos: { demo: repoDir }, transport: recordingTransport(calls) });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("lists doc and diagram templates", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/templates" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().templates.map((t: { id: string }) => t.id);
    expect(ids).toEqual(["blank", "adr", "architecture-overview", "mmd-flowchart", "mmd-sequence"]);
  });

  it("fires a new-file proposal from a template without writing the repo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/docs/new",
      payload: { repo: "demo", path: "docs/adr/0001-use-sqlite.md", template: "adr", requestedBy: "Mathew" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.itemId).toBe("doc:demo:docs/adr/0001-use-sqlite.md");
    expect(body.proposal.status).toBe("pending");
    expect(body.proposal.target_type).toBe("doc");
    expect(body.proposal.description).toBe("Create docs/adr/0001-use-sqlite.md");
    expect(body.proposal.diff.split("\n").slice(0, 3)).toEqual([
      "--- /dev/null",
      "+++ b/docs/adr/0001-use-sqlite.md",
      "+ # ADR: Title",
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("proposeChange");
    expect(calls[0].params).toMatchObject({ itemId: body.itemId, targetType: "doc", sourceRepo: "demo" });

    // Consus never writes the repo — the harness creates the file.
    expect(existsSync(join(repoDir, "docs/adr/0001-use-sqlite.md"))).toBe(false);
  });

  it("uses edited content over the template when given", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/docs/new",
      payload: {
        repo: "demo",
        path: "flows/login.mmd",
        template: "mmd-flowchart",
        content: "flowchart LR\n  a --> b\n",
        description: "login flow",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().proposal.diff).toBe("--- /dev/null\n+++ b/flows/login.mmd\n+ flowchart LR\n+   a --> b");
    expect(res.json().proposal.description).toBe("login flow");
  });

  it("409s when the file already exists", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/docs/new",
      payload: { repo: "demo", path: "README.md", template: "blank" },
    });
    expect(res.statusCode).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it("409s a second new-file proposal for a path that already has one pending", async () => {
    const payload = { repo: "demo", path: "docs/new.md", template: "blank" };
    expect((await app.inject({ method: "POST", url: "/api/docs/new", payload })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/docs/new", payload })).statusCode).toBe(409);
  });

  it.each([
    ["../outside.md", "relative and inside the repo"],
    ["/etc/passwd.md", "relative and inside the repo"],
    ["docs/../../x.md", "relative and inside the repo"],
    ["docs/notes.txt", "must end in"],
  ])("400s on bad path %s", async (path, message) => {
    const res = await app.inject({ method: "POST", url: "/api/docs/new", payload: { repo: "demo", path, template: "blank" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain(message);
  });

  it("400s when the template's extension doesn't match the path", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/docs/new",
      payload: { repo: "demo", path: "docs/x.md", template: "mmd-sequence" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s on an unknown template or no content, 404s an unknown repo", async () => {
    const unknownTemplate = await app.inject({
      method: "POST",
      url: "/api/docs/new",
      payload: { repo: "demo", path: "docs/x.md", template: "nope" },
    });
    expect(unknownTemplate.statusCode).toBe(400);

    const noContent = await app.inject({ method: "POST", url: "/api/docs/new", payload: { repo: "demo", path: "docs/x.md" } });
    expect(noContent.statusCode).toBe(400);

    const unknownRepo = await app.inject({
      method: "POST",
      url: "/api/docs/new",
      payload: { repo: "nope", path: "docs/x.md", template: "blank" },
    });
    expect(unknownRepo.statusCode).toBe(404);
  });
});
