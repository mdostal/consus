import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCascadeTree } from "./cascade-tree.js";
import type { MulticaClient } from "../../adapters/multica/client.js";

function writeEpic(root: string, id: string, title: string, stories: Array<{ id: string; title: string }> = []) {
  const epicDir = join(root, ".pHive", "epics", id);
  mkdirSync(join(epicDir, "stories"), { recursive: true });
  writeFileSync(join(epicDir, "epic.yaml"), `name: ${id}\ntitle: ${title}\nstatus: pending\n`);
  for (const story of stories) {
    writeFileSync(
      join(epicDir, "stories", `${story.id}.yaml`),
      `id: ${story.id}\nepic: ${id}\ntitle: ${story.title}\nstatus: pending\n`,
    );
  }
}

describe("cascade tree generation", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "consus-cascade-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns Mermaid from seed to meta-orchestrator to merged disk and Multica stories", async () => {
    writeEpic(root, "s2-01", "Diagram Schema", [{ id: "schema-cache", title: "Cache helper" }]);
    const client = {
      listEpics: async () => ({
        ok: true as const,
        epics: [
          {
            id: "epic-api-2",
            identifier: "s2-02",
            title: "Repo Diagrams",
            description: null,
            status: "in_progress",
            priority: null,
            labels: [],
            updatedAt: "2026-08-10T00:00:00Z",
            createdAt: null,
          },
        ],
      }),
      listStories: async () => ({
        ok: true as const,
        stories: [
          {
            id: "story-api-1",
            identifier: "repo-map",
            title: "Repository map",
            description: null,
            status: "todo",
            priority: null,
            labels: [],
            updatedAt: "2026-08-10T00:00:00Z",
            createdAt: null,
            epicId: "epic-api-2",
          },
        ],
      }),
    } satisfies Pick<MulticaClient, "listEpics" | "listStories">;

    const result = await buildCascadeTree({ client, pHiveRoot: root });

    expect(result.mermaidSource).toContain("graph TD");
    expect(result.mermaidSource).toContain('node_seed["Seed"]');
    expect(result.mermaidSource).toContain('node_meta_orchestrator["Meta Orchestrator"]');
    expect(result.mermaidSource).toContain("node_seed --> node_meta_orchestrator");
    expect(result.mermaidSource).toContain("s2-01: Diagram Schema");
    expect(result.mermaidSource).toContain("schema-cache: Cache helper");
    expect(result.mermaidSource).toContain("s2-02: Repo Diagrams (in_progress)");
    expect(result.mermaidSource).toContain("repo-map: Repository map (todo)");
  });

  it("renders all 12 slice-2 epics as meta-orchestrator children", async () => {
    for (let i = 1; i <= 12; i += 1) {
      const id = `s2-${String(i).padStart(2, "0")}`;
      writeEpic(root, id, `Slice 2 Epic ${i}`);
    }
    const client = {
      listEpics: async () => ({ ok: true as const, epics: [] }),
      listStories: async () => ({ ok: true as const, stories: [] }),
    } satisfies Pick<MulticaClient, "listEpics" | "listStories">;

    const result = await buildCascadeTree({ client, pHiveRoot: root });

    expect(result.tree.epics).toHaveLength(12);
    expect(result.mermaidSource.match(/node_meta_orchestrator --> epic_s2_/g)).toHaveLength(12);
  });

  it("changes the source signature when epic or story state changes", async () => {
    const client = {
      listEpics: async () => ({
        ok: true as const,
        epics: [
          {
            id: "epic-api-1",
            identifier: "s2-01",
            title: "Diagram Schema",
            description: null,
            status: "todo",
            priority: null,
            labels: [],
            updatedAt: "2026-08-10T00:00:00Z",
            createdAt: null,
          },
        ],
      }),
      listStories: async () => ({ ok: true as const, stories: [] }),
    } satisfies Pick<MulticaClient, "listEpics" | "listStories">;
    const first = await buildCascadeTree({ client, pHiveRoot: root });
    const changedClient = {
      ...client,
      listEpics: async () => ({
        ok: true as const,
        epics: [{ ...(await client.listEpics()).epics[0], status: "done", updatedAt: "2026-08-10T01:00:00Z" }],
      }),
    } satisfies Pick<MulticaClient, "listEpics" | "listStories">;

    const second = await buildCascadeTree({ client: changedClient, pHiveRoot: root });

    expect(second.stateSignature).not.toBe(first.stateSignature);
  });
});
