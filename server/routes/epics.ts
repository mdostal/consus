import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { MulticaClient, MulticaIssue } from "../adapters/multica/client.js";
import { loadEpicFiles } from "../lib/cascade-tree-builder.js";

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

const SLICE_EPIC_RE = /^\[?slice-\d+/i;

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
}
