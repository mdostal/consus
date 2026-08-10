import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { epicsRoutes } from "./epics.js";
import type { MulticaClient } from "../adapters/multica/client.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("GET /api/epics/:id/docs", () => {
  it("returns 404 if epic not found in either source", async () => {
    const app = Fastify();
    const mockClient = {
      getIssue: vi.fn().mockResolvedValue({ ok: false }),
    } as unknown as MulticaClient;

    app.register(epicsRoutes, { client: mockClient, repos: { consus: "/nonexistent" } });
    const response = await app.inject({
      method: "GET",
      url: "/consus-v1/docs"
    });

    expect(response.statusCode).toBe(404);
  });

  it("merges docs from disk and Multica", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "epics-test-"));
    mkdirSync(join(repoDir, ".pHive", "epics", "consus-v1", "docs"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "epics", "consus-v1", "stories"), { recursive: true });
    
    writeFileSync(join(repoDir, ".pHive", "epics", "consus-v1", "docs", "design-discussion.md"), "# disk design");
    writeFileSync(join(repoDir, ".pHive", "epics", "consus-v1", "stories", "story-01.yaml"), "id: story-01\ntitle: Disk Story");

    const mockClient = {
      getIssue: vi.fn().mockResolvedValue({
        ok: true,
        issue: { id: "epic-id", title: "Consus V1", description: "epic desc" }
      }),
      getIssueChildren: vi.fn().mockResolvedValue({
        ok: true,
        issues: [
          { id: "child-1", title: "design-discussion", description: "# multica design" },
          { id: "story-01", title: "Story 01 from Multica", description: "story desc" }
        ]
      }),
      getIssueComments: vi.fn().mockResolvedValue({
        ok: true,
        comments: []
      })
    } as unknown as MulticaClient;

    const app = Fastify();
    app.register(epicsRoutes, { client: mockClient, repos: { consus: repoDir } });
    
    const response = await app.inject({
      method: "GET",
      url: "/consus-v1/docs"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.docs).toBeDefined();
    
    const designDoc = body.docs.find((d: any) => d.type === "design-discussion");
    expect(designDoc).toBeDefined();
    expect(designDoc.provenance).toBe("multica"); // Multica wins

    const storyDoc = body.docs.find((d: any) => d.type === "story" && d.id === "story-01");
    expect(storyDoc).toBeDefined();
    expect(storyDoc.provenance).toBe("multica");
    
    rmSync(repoDir, { recursive: true, force: true });
  });
});
