import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerEpicRoutes } from "./epics.js";
import type { MulticaClient, MulticaListResult } from "../adapters/multica/client.js";
import * as cascadeBuilder from "../lib/cascade-tree-builder.js";

describe("Epic Routes", () => {
  it("merges Multica epics and disk epics and picks max date", async () => {
    const app = Fastify();
    
    const mockClient = {
      listIssues: vi.fn().mockResolvedValue({
        ok: true,
        issues: [
          {
            id: "m1",
            title: "slice-1-foo",
            status: "in_progress",
            updatedAt: "2026-08-10T10:00:00.000Z",
            parentId: null,
          },
          {
            id: "s1",
            title: "story 1",
            status: "todo",
            parentId: "m1",
          }
        ],
      } as MulticaListResult)
    } as unknown as MulticaClient;

    vi.spyOn(cascadeBuilder, "loadEpicFiles").mockReturnValue([
      {
        repo: "repo1",
        name: "slice-1",
        title: "Slice 1 Foo", // Should merge with slice-1-foo
        updatedAt: "2026-08-10T12:00:00.000Z", // newer than multica
        stories: [{ id: "s2", title: "s2" }, { id: "s3", title: "s3" }] // 2 stories
      },
      {
        repo: "repo1",
        name: "slice-2",
        title: "slice-2-bar",
        updatedAt: "2026-08-09T10:00:00.000Z",
        stories: [{ id: "s4", title: "s4" }]
      }
    ]);

    registerEpicRoutes(app, { db: {} as any, client: mockClient, repos: { repo1: "/path" } });

    const response = await app.inject({
      method: "GET",
      url: "/api/epics",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json).toHaveLength(2);

    // slice-1 should be merged
    const slice1 = json.find((e: any) => e.title === "slice-1-foo");
    expect(slice1).toBeDefined();
    expect(slice1.status).toBe("in_progress");
    expect(slice1.last_updated).toBe("2026-08-10T12:00:00.000Z"); // max date from disk
    expect(slice1.story_count).toBe(2); // max(1 multica story, 2 disk stories)

    // slice-2 from disk
    const slice2 = json.find((e: any) => e.title === "slice-2-bar");
    expect(slice2).toBeDefined();
    expect(slice2.status).toBe("disk");
  });
});
