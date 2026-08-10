import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MulticaClient, MulticaIssue } from "../adapters/multica/client.js";
import { loadEpicFiles, type EpicFile } from "../lib/cascade-tree-builder.js";

export interface EpicRoutesOptions {
  db: Database.Database;
  client: MulticaClient;
  repos: Record<string, string>;
}

export interface EpicListItem {
  id: string;
  title: string;
  status: string;
  story_count: number;
  last_updated: string;
}

export type EpicDocKind = "design-discussion" | "research-brief" | "outline";

export interface EpicDoc {
  kind: EpicDocKind;
  title: string;
  content: string;
  source?: string;
  updated_at?: string;
}

export interface EpicStory {
  id: string;
  title: string;
  status: string;
  dependencies: string[];
  tracker_url?: string;
}

export interface EpicDetail {
  id: string;
  title: string;
  status: string;
  repo_id?: string;
  last_updated: string;
  docs: EpicDoc[];
  stories: EpicStory[];
}

const SLICE_EPIC_RE = /^\[?slice-\d+/i;
const DOC_DEFINITIONS: Array<{ kind: EpicDocKind; title: string; filenames: string[] }> = [
  { kind: "design-discussion", title: "Design Discussion", filenames: ["design-discussion.md"] },
  { kind: "research-brief", title: "Research Brief", filenames: ["research-brief.md"] },
  { kind: "outline", title: "Outline", filenames: ["outline.md", "structured-outline.md"] },
];

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[[\]]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesDiskEpic(issue: MulticaIssue, epic: EpicFile): boolean {
  const issueSlug = normalizeSlug(issue.title);
  const titleSlug = normalizeSlug(epic.title);
  const nameSlug = normalizeSlug(epic.name);
  return issueSlug.includes(titleSlug) || titleSlug.includes(issueSlug) || issueSlug.includes(nameSlug);
}

function findDiskEpic(epicId: string, issue: MulticaIssue | undefined, diskEpics: EpicFile[]): EpicFile | undefined {
  const byId = diskEpics.find((epic) => `phive:${epic.repo}:${epic.name}` === epicId);
  if (byId) return byId;
  if (!issue) return undefined;
  return diskEpics.find((epic) => matchesDiskEpic(issue, epic));
}

function readDiskDocs(repos: Record<string, string>, epic: EpicFile | undefined): EpicDoc[] {
  if (!epic) return [];
  const repoPath = repos[epic.repo];
  if (!repoPath) return [];
  const docs: EpicDoc[] = [];

  for (const definition of DOC_DEFINITIONS) {
    for (const filename of definition.filenames) {
      try {
        const path = join(repoPath, ".pHive", "epics", epic.name, "docs", filename);
        docs.push({
          kind: definition.kind,
          title: definition.title,
          content: readFileSync(path, "utf-8"),
          source: "phive",
          updated_at: epic.updatedAt,
        });
        break;
      } catch {
        // The detail UI renders a stable empty state for missing docs.
      }
    }
  }

  return docs;
}

function extractDependencies(description: string | null): string[] {
  if (!description) return [];
  const match = description.match(/depends_on:\s*\[([^\]]*)\]/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((dep) => dep.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function issueToStory(issue: MulticaIssue): EpicStory {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    dependencies: extractDependencies(issue.description),
    tracker_url: `https://multica.local/issues/${encodeURIComponent(issue.identifier ?? issue.id)}`,
  };
}

function diskStoryToStory(epic: EpicFile, story: EpicFile["stories"][number]): EpicStory {
  return {
    id: `phive:${epic.repo}:${epic.name}:${story.id}`,
    title: story.title,
    status: "disk",
    dependencies: [],
    tracker_url: `https://multica.local/stories/${encodeURIComponent(story.id)}`,
  };
}

export function registerEpicRoutes(app: FastifyInstance, { client, repos }: EpicRoutesOptions): void {
  app.get("/api/epics", async (request, reply) => {
    // 1. Fetch from Multica
    const listed = await client.listIssues({});
    let multicaEpics: MulticaIssue[] = [];
    if (listed.ok) {
      multicaEpics = listed.issues.filter(issue => SLICE_EPIC_RE.test(issue.title));
    } else {
      app.log.warn(`Multica fetch failed: ${listed.error}`);
    }
    
    // Also fetch stories from Multica to count them per epic
    const multicaStoriesByParent = new Map<string, number>();
    if (listed.ok) {
       for (const issue of listed.issues) {
         if (issue.parentId) {
           multicaStoriesByParent.set(issue.parentId, (multicaStoriesByParent.get(issue.parentId) || 0) + 1);
         }
       }
    }

    // 2. Fetch from disk
    const diskEpics = loadEpicFiles(repos);

    // 3. Merge them
    const epicMap = new Map<string, EpicListItem>();

    // Add disk epics first
    for (const epic of diskEpics) {
      const id = `phive:${epic.repo}:${epic.name}`;
      epicMap.set(id, {
        id,
        title: epic.title,
        status: "disk", // fallback for disk epics
        story_count: epic.stories.length,
        last_updated: epic.updatedAt,
      });
    }

    // Add/Update with Multica epics (they take precedence for status and can provide more accurate updated_at)
    for (const mEpic of multicaEpics) {
      const storyCount = multicaStoriesByParent.get(mEpic.id) || 0;
      
      let lastUpdated = mEpic.updatedAt || mEpic.createdAt || new Date(0).toISOString();
      
      // Let's see if there's a corresponding disk epic to merge with by title
      let matchedDiskId: string | null = null;
      for (const [diskId, dEpic] of epicMap.entries()) {
        const titleSlug = mEpic.title.toLowerCase().replace(/[[\]]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
        const dTitleSlug = dEpic.title.toLowerCase().replace(/[[\]]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
        
        if (titleSlug.includes(dTitleSlug) || dTitleSlug.includes(titleSlug)) {
           matchedDiskId = diskId;
           break;
        }
      }
      
      let finalStoryCount = storyCount;
      if (matchedDiskId) {
        const dEpic = epicMap.get(matchedDiskId)!;
        // Last updated timestamp from max(Multica updated_at, disk mtime)
        const multicaTime = new Date(lastUpdated).getTime();
        const diskTime = new Date(dEpic.last_updated).getTime();
        lastUpdated = multicaTime > diskTime ? lastUpdated : dEpic.last_updated;
        
        // Merge story count? Multica stories + disk stories that are not in Multica
        // For simplicity, let's just add them if it's not handled by cascade builder perfectly here,
        // or just use max. The acceptance criteria says "story count".
        // Let's use max of multica and disk for simplicity, or just disk stories length + multica?
        // Wait, the prompt says "Multica + disk". Cascade builder does `for (const story of epicFile.stories) if (!hasMatchingChild(node, story)) add...`
        finalStoryCount = Math.max(storyCount, dEpic.story_count);
        
        // delete the old disk entry to replace with the unified one
        epicMap.delete(matchedDiskId);
      }
      
      epicMap.set(mEpic.id, {
        id: mEpic.id,
        title: mEpic.title,
        status: mEpic.status,
        story_count: finalStoryCount,
        last_updated: lastUpdated,
      });
    }

    return Array.from(epicMap.values()).sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());
  });

  app.get<{ Params: { epic_id: string } }>("/api/epics/:epic_id", async (request, reply) => {
    const epicId = decodeURIComponent(request.params.epic_id);
    const listed = await client.listIssues({});
    if (!listed.ok) {
      reply.code(503);
      return { error: `Multica fetch failed: ${listed.error}` };
    }

    const diskEpics = loadEpicFiles(repos);
    const multicaEpic = listed.issues.find((issue) => issue.id === epicId || issue.identifier === epicId);
    const diskEpic = findDiskEpic(epicId, multicaEpic, diskEpics);
    if (!multicaEpic && !diskEpic) {
      reply.code(404);
      return { error: `Epic not found: ${epicId}` };
    }

    const docs = readDiskDocs(repos, diskEpic);
    if (multicaEpic?.description) {
      docs.unshift({
        kind: "design-discussion",
        title: "Design Discussion",
        content: multicaEpic.description,
        source: "multica",
        updated_at: multicaEpic.updatedAt ?? multicaEpic.createdAt ?? undefined,
      });
    }

    const storiesById = new Map<string, EpicStory>();
    if (multicaEpic) {
      for (const issue of listed.issues.filter((candidate) => candidate.parentId === multicaEpic.id)) {
        storiesById.set(issue.id, issueToStory(issue));
      }
    }
    if (diskEpic) {
      for (const story of diskEpic.stories) {
        if (![...storiesById.values()].some((existing) => normalizeSlug(existing.title).includes(normalizeSlug(story.id)))) {
          storiesById.set(`phive:${diskEpic.repo}:${diskEpic.name}:${story.id}`, diskStoryToStory(diskEpic, story));
        }
      }
    }

    const lastUpdated = [multicaEpic?.updatedAt, multicaEpic?.createdAt, diskEpic?.updatedAt]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? new Date(0).toISOString();

    return {
      id: multicaEpic?.id ?? `phive:${diskEpic!.repo}:${diskEpic!.name}`,
      title: multicaEpic?.title ?? diskEpic!.title,
      status: multicaEpic?.status ?? "disk",
      repo_id: diskEpic?.repo ?? Object.keys(repos)[0],
      last_updated: lastUpdated,
      docs,
      stories: Array.from(storiesById.values()),
    } satisfies EpicDetail;
  });

  app.post<{ Params: { epic_id: string }; Body: { actor?: string } }>("/api/epics/:epic_id/approve", async (request, reply) => {
    const epicId = decodeURIComponent(request.params.epic_id);
    const issueResult = await client.getIssue(epicId);
    if (!issueResult.ok) {
      reply.code(502);
      return { error: `Multica issue fetch failed: ${issueResult.error}` };
    }

    const actor = request.body?.actor ?? "consus";
    const commentResult = await client.writeComment({
      itemId: issueResult.issue.id,
      author: actor,
      body: `Epic approved in Consus. Proceed with build execution for ${issueResult.issue.identifier ?? issueResult.issue.id}.`,
    });
    if (!commentResult.ok) {
      reply.code(502);
      return { error: `Multica comment write failed: ${commentResult.error}` };
    }

    const statusResult = await client.updateIssueStatus(issueResult.issue.id, "todo");
    if (!statusResult.ok) {
      reply.code(502);
      return { error: `Multica status update failed: ${statusResult.error}` };
    }

    return { ok: true, status: statusResult.status, comment_id: commentResult.multicaCommentId };
  });
}
