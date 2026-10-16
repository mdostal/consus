import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerSendOutRoutes } from "./send-out.js";
import type { HarnessTransport, HarnessResult } from "../harness/transport.js";

const DOC = "# Architecture\n\nThe API talks to the DB.\n\n```mermaid\ngraph TD\n  api[\"API\"] --> db[\"DB\"]\n```\n";

const EPIC_YAML = `
name: epic-a
title: "Epic A"
stories:
  - id: s-1
    title: "One"
    complexity: low
    depends_on: []
  - id: s-2
    title: "Two"
    depends_on: [s-1]
`;

describe("send-out routes", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;
  let dispatched: Array<{ method: string; params: unknown }>;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-send-out-"));
    mkdirSync(join(repoDir, "docs"));
    mkdirSync(join(repoDir, "server"));
    mkdirSync(join(repoDir, ".pHive", "epics", "epic-a"), { recursive: true });
    writeFileSync(join(repoDir, "docs", "arch.md"), DOC);
    writeFileSync(join(repoDir, "docs", "brand.html"), "<!doctype html><html><body>brand</body></html>");
    writeFileSync(join(repoDir, ".pHive", "epics", "epic-a", "epic.yaml"), EPIC_YAML);

    dispatched = [];
    const transport: HarnessTransport = {
      async invoke<T>(method: string, params?: unknown) {
        dispatched.push({ method, params });
        return { ok: true, result: {} } as HarnessResult<T>;
      },
    };
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerSendOutRoutes(app, { db, repos: { repo: repoDir }, transport });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  const exportDoc = (format: string, path = "docs/arch.md") =>
    app.inject({ method: "GET", url: `/api/export/doc?repo=repo&path=${encodeURIComponent(path)}&format=${format}` });
  const exportDiagram = (kind: string, format: string) =>
    app.inject({ method: "GET", url: `/api/export/diagram?repo=repo&kind=${kind}&format=${format}` });

  describe("GET /api/export/doc", () => {
    it("format=md downloads the raw markdown, byte for byte", async () => {
      const res = await exportDoc("md");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/markdown; charset=utf-8");
      expect(res.headers["content-disposition"]).toBe('attachment; filename="arch.md"');
      expect(res.body).toBe(DOC);
    });

    it("format=html downloads a standalone rendered page with the mermaid diagram inlined", async () => {
      const res = await exportDoc("html");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(res.headers["content-disposition"]).toBe('attachment; filename="arch.html"');
      const doc = new DOMParser().parseFromString(res.body, "text/html");
      expect(doc.querySelector("h1")?.textContent).toBe("Architecture");
      expect(Array.from(doc.querySelectorAll("svg g[data-node-id]"), (g) => g.textContent)).toEqual(["API", "DB"]);
      expect(doc.querySelectorAll("script, link, iframe, [src]")).toHaveLength(0);
    });

    it("format=html ships a full-page .html doc unchanged", async () => {
      const res = await exportDoc("html", "docs/brand.html");
      expect(res.body).toBe("<!doctype html><html><body>brand</body></html>");
    });

    it("format=claude-prompt returns the prompt inline (not as a download) and upserts the item", async () => {
      const res = await exportDoc("claude-prompt");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-disposition"]).toBeUndefined();
      expect(res.body).toContain("item id: doc:repo:docs/arch.md");
      expect(res.body).toContain(DOC.trimEnd());
      expect(res.body).toContain("http://localhost:80/api/items/doc%3Arepo%3Adocs%2Farch.md/import");
      expect(db.prepare("SELECT type FROM items WHERE id = ?").get("doc:repo:docs/arch.md")).toEqual({ type: "doc" });
    });

    it("rejects bad input", async () => {
      expect((await exportDoc("pdf")).statusCode).toBe(400);
      expect((await exportDoc("md", "docs/missing.md")).statusCode).toBe(404);
      expect((await exportDoc("md", "../../etc/passwd")).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/api/export/doc?repo=nope&path=a.md" })).statusCode).toBe(404);
    });
  });

  describe("GET /api/export/diagram", () => {
    it("format=mmd downloads the cascade's mermaid source", async () => {
      const res = await exportDiagram("cascade", "mmd");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-disposition"]).toBe('attachment; filename="repo-cascade.mmd"');
      expect(res.body).toBe(
        'graph LR\n  subgraph n_epic_epic_a["Epic A"]\n    n_story_s_1["One (low)"]\n    n_story_s_2["Two"]\n  end\n  n_story_s_1 --> n_story_s_2\n',
      );
    });

    it("format=svg downloads well-formed SVG for every kind", async () => {
      for (const kind of ["cascade", "architecture", "architecture-full"]) {
        const res = await exportDiagram(kind, "svg");
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
        const svg = new DOMParser().parseFromString(res.body, "image/svg+xml");
        expect(svg.getElementsByTagName("parsererror")).toHaveLength(0);
        expect(svg.querySelectorAll("g[data-node-id]").length).toBeGreaterThan(0);
      }
      const arch = await exportDiagram("architecture", "svg");
      expect(arch.body).toContain(">server<");
    });

    it("format=md wraps the source in a mermaid fence; format=html renders it standalone", async () => {
      const md = await exportDiagram("architecture", "md");
      expect(md.body).toMatch(/^# repo architecture\n\n```mermaid\ngraph TD\n/);
      const html = await exportDiagram("architecture", "html");
      const doc = new DOMParser().parseFromString(html.body, "text/html");
      expect(doc.querySelector("figure svg")).not.toBeNull();
      expect(doc.querySelectorAll("script, link, iframe, [src]")).toHaveLength(0);
    });

    it("format=claude-prompt carries the diagram id, kind and source", async () => {
      const res = await exportDiagram("architecture", "claude-prompt");
      expect(res.body).toContain("item id: diagram:repo");
      expect(res.body).toContain('"kind":"architecture"');
      expect(res.body).toContain("```mermaid\ngraph TD");
    });

    it("rejects an unknown kind or format", async () => {
      expect((await exportDiagram("org", "svg")).statusCode).toBe(400);
      expect((await exportDiagram("cascade", "png")).statusCode).toBe(400);
    });
  });

  describe("claude artifact URL", () => {
    it("sets, reads, clears, and audits the URL", async () => {
      await exportDoc("md"); // upserts the item
      const url = "/api/items/doc%3Arepo%3Adocs%2Farch.md/claude-artifact";
      expect((await app.inject({ method: "GET", url })).json()).toEqual({ itemId: "doc:repo:docs/arch.md", url: null });

      const set = await app.inject({
        method: "PUT",
        url,
        payload: { url: "https://claude.ai/artifact/abc", actor: "Mathew" },
      });
      expect(set.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url })).json().url).toBe("https://claude.ai/artifact/abc");

      await app.inject({ method: "PUT", url, payload: { url: null, actor: "Mathew" } });
      expect((await app.inject({ method: "GET", url })).json().url).toBeNull();

      const audit = db.prepare("SELECT old_value, new_value FROM audit_log WHERE field = 'claude_artifact_url' ORDER BY id").all();
      expect(audit).toEqual([
        { old_value: null, new_value: "https://claude.ai/artifact/abc" },
        { old_value: "https://claude.ai/artifact/abc", new_value: null },
      ]);
    });

    it("rejects non-https URLs, a missing actor, and unknown items", async () => {
      await exportDoc("md");
      const url = "/api/items/doc%3Arepo%3Adocs%2Farch.md/claude-artifact";
      expect((await app.inject({ method: "PUT", url, payload: { url: "javascript:alert(1)", actor: "M" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "PUT", url, payload: { url: "https://x" } })).statusCode).toBe(400);
      expect(
        (await app.inject({ method: "PUT", url: "/api/items/nope/claude-artifact", payload: { url: null, actor: "M" } }))
          .statusCode,
      ).toBe(404);
    });
  });

  describe("POST /api/items/:id/import (round trip)", () => {
    it("export .md -> edit outside -> import creates a proposal with the right diff, and leaves the repo untouched", async () => {
      const exported = (await exportDoc("md")).body;
      const edited = exported.replace("The API talks to the DB.", "The API talks to the DB through a cache.");

      const res = await app.inject({
        method: "POST",
        url: "/api/items/doc%3Arepo%3Adocs%2Farch.md/import",
        payload: { content: edited.replace(/\n/g, "\r\n"), filename: "arch.md", description: "add cache", requestedBy: "Mathew" },
      });
      expect(res.statusCode).toBe(201);
      const proposal = res.json();
      expect(proposal).toMatchObject({
        item_id: "doc:repo:docs/arch.md",
        target_type: "doc",
        status: "pending",
        requested_by: "Mathew",
        description: "Imported from outside Consus (arch.md): add cache",
      });
      const changed = proposal.diff.split("\n").filter((l: string) => !l.startsWith("  "));
      expect(changed).toEqual(["- The API talks to the DB.", "+ The API talks to the DB through a cache."]);

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({ method: "proposeChange", params: { itemId: "doc:repo:docs/arch.md", sourceRepo: "repo" } });
      expect(readFileSync(join(repoDir, "docs", "arch.md"), "utf-8")).toBe(DOC);
    });

    it("export .mmd -> edit outside -> import creates a diagram proposal", async () => {
      const exported = (await exportDiagram("cascade", "mmd")).body;
      const edited = exported.replace('n_story_s_2["Two"]', 'n_story_s_2["Two (high)"]');

      const res = await app.inject({
        method: "POST",
        url: "/api/items/diagram%3Arepo/import",
        payload: { content: edited, filename: "repo-cascade.mmd", requestedBy: "Mathew", kind: "cascade" },
      });
      expect(res.statusCode).toBe(201);
      const changed = res
        .json()
        .diff.split("\n")
        .filter((l: string) => !l.startsWith("  "));
      expect(changed).toEqual(['-     n_story_s_2["Two"]', '+     n_story_s_2["Two (high)"]']);
      expect(res.json().target_type).toBe("diagram");
    });

    it("accepts a diagram that comes back as markdown with a mermaid fence", async () => {
      await exportDiagram("architecture", "mmd");
      const md = (await exportDiagram("architecture", "md")).body.replace("graph TD", "graph TD\n  root --> extra[\"extra\"]");
      const res = await app.inject({
        method: "POST",
        url: "/api/items/diagram%3Arepo/import",
        payload: { content: md, requestedBy: "Mathew", kind: "architecture" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().diff).toContain('+   root --> extra["extra"]');
      expect(res.json().description).toBe("Imported from outside Consus (pasted content)");
    });

    it("refuses an import identical to the current content", async () => {
      await exportDoc("md");
      const res = await app.inject({
        method: "POST",
        url: "/api/items/doc%3Arepo%3Adocs%2Farch.md/import",
        payload: { content: DOC, requestedBy: "Mathew" },
      });
      expect(res.statusCode).toBe(422);
      expect(dispatched).toHaveLength(0);
    });

    it("validates the body and the target item", async () => {
      await exportDoc("md");
      const url = "/api/items/doc%3Arepo%3Adocs%2Farch.md/import";
      expect((await app.inject({ method: "POST", url, payload: { requestedBy: "M" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url, payload: { content: "x" } })).statusCode).toBe(400);
      expect(
        (await app.inject({ method: "POST", url: "/api/items/nope/import", payload: { content: "x", requestedBy: "M" } }))
          .statusCode,
      ).toBe(404);
      await exportDiagram("cascade", "mmd");
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/items/diagram%3Arepo/import",
            payload: { content: "graph TD", requestedBy: "M", kind: "org" },
          })
        ).statusCode,
      ).toBe(400);
    });
  });
});
