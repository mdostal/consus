import type Database from "better-sqlite3";
import { queryDocIndex, type DocIndexRow } from "../../adapters/doc-scanner/index.js";
import { join } from "node:path";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import yaml from "yaml";
import type { MulticaClient, MulticaIssue } from "../../adapters/multica/client.js";

export interface ComposeLivingDocOptions {
  repoName: string;
  repoPath: string;
  itemId: string;
}

export interface CommentRow {
  id: number;
  item_id: string;
  author: string;
  body: string;
  created_at: string;
  multica_comment_id: string | null;
}

export interface LivingDocView {
  docs: DocIndexRow[];
  comments: CommentRow[];
  ideaBoard: { available: false; reason: string };
}

export function composeLivingDoc(db: Database.Database, { repoName, repoPath, itemId }: ComposeLivingDocOptions): LivingDocView {
  void repoPath;

  const docs = queryDocIndex(db, repoName);
  const comments = db
    .prepare("SELECT * FROM comments WHERE item_id = ? ORDER BY created_at ASC")
    .all(itemId) as CommentRow[];

  return {
    docs,
    comments,
    ideaBoard: { available: false, reason: "idea board integration point not yet specified" },
  };
}

export interface EpicDoc {
  id: string;
  title: string;
  content: string;
  source: "multica" | "on-disk" | "merged";
  updatedAt: string;
}

export interface Story {
  id: string;
  title: string;
  status: string;
  description?: string;
  source: "multica" | "on-disk" | "merged";
  updatedAt: string;
  [key: string]: any;
}

export interface EpicDocsView {
  docs: Record<string, EpicDoc>;
  stories: Story[];
}

export async function composeEpicDocs(
  client: MulticaClient,
  epicId: string,
  repoPath: string
): Promise<EpicDocsView> {
  const result: EpicDocsView = { docs: {}, stories: [] };

  // 1. Multica API
  let multicaEpic: MulticaIssue | null = null;
  const epicRes = await client.getIssue(epicId);
  if (epicRes.ok) {
    multicaEpic = epicRes.issue;
  }

  const multicaIssuesRes = await client.listIssues({ limit: 1000 });
  const multicaStories = multicaIssuesRes.ok 
    ? multicaIssuesRes.issues.filter(i => i.parentIssueId === epicId || i.labels.includes(`epic:${epicId}`)) 
    : [];

  const multicaCommentsRes = typeof client.listComments === 'function' ? await client.listComments(epicId) : { ok: false, comments: [] };
  const multicaComments = multicaCommentsRes.ok ? multicaCommentsRes.comments : [];

  // Parse Multica docs from comments or issue description
  // If the epic description exists, maybe it's a doc? Let's just use it as 'epic-description'
  if (multicaEpic && multicaEpic.description) {
    result.docs["epic-description"] = {
      id: "epic-description",
      title: "Epic Description",
      content: multicaEpic.description,
      source: "multica",
      updatedAt: multicaEpic.updatedAt || multicaEpic.createdAt || new Date().toISOString()
    };
  }

  // Parse comments into docs if they look like docs, or just store them
  // Assuming each comment could be a doc if it has a markdown header, else just dump as 'discussion'
  let commentIndex = 0;
  for (const comment of multicaComments) {
    const lines = comment.body.trim().split('\n');
    let docId = `comment-${comment.id || commentIndex}`;
    let title = `Comment ${commentIndex + 1}`;
    
    if (lines[0].startsWith('#')) {
      title = lines[0].replace(/^#+\s*/, '').trim();
      docId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    result.docs[docId] = {
      id: docId,
      title,
      content: comment.body,
      source: "multica",
      updatedAt: comment.updated_at || comment.created_at || new Date().toISOString()
    };
    commentIndex++;
  }

  // 2. On-disk .pHive/epics/{epicId}/docs/*.md
  const docsDir = join(repoPath, ".pHive", "epics", epicId, "docs");
  if (existsSync(docsDir)) {
    const files = readdirSync(docsDir).filter(f => f.endsWith(".md"));
    for (const file of files) {
      const docId = file.replace(".md", "");
      const absPath = join(docsDir, file);
      const content = readFileSync(absPath, "utf-8");
      const stat = statSync(absPath);
      const fileUpdatedAt = stat.mtime.toISOString();

      const existing = result.docs[docId];
      if (existing) {
        if (new Date(fileUpdatedAt) > new Date(existing.updatedAt)) {
          existing.content = content;
          existing.source = "merged";
          existing.updatedAt = fileUpdatedAt;
        }
      } else {
        result.docs[docId] = {
          id: docId,
          title: docId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          content,
          source: "on-disk",
          updatedAt: fileUpdatedAt
        };
      }
    }
  }

  // 3. On-disk .pHive/epics/{epicId}/stories/*.yaml
  const storiesMap = new Map<string, Story>();
  
  // Add Multica stories first
  for (const issue of multicaStories) {
    storiesMap.set(issue.id, {
      id: issue.id,
      title: issue.title,
      status: issue.status,
      description: issue.description || undefined,
      source: "multica",
      updatedAt: issue.updatedAt || issue.createdAt || new Date().toISOString()
    });
  }

  const storiesDir = join(repoPath, ".pHive", "epics", epicId, "stories");
  if (existsSync(storiesDir)) {
    const files = readdirSync(storiesDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      const storyId = file.replace(/\.ya?ml$/, "");
      const absPath = join(storiesDir, file);
      const stat = statSync(absPath);
      const fileUpdatedAt = stat.mtime.toISOString();
      let parsed: any = {};
      try {
        parsed = yaml.parse(readFileSync(absPath, "utf-8")) || {};
      } catch (e) {
        // ignore parse errors
      }

      const existing = storiesMap.get(storyId) || Array.from(storiesMap.values()).find(s => s.id === parsed.id);
      
      if (existing) {
        // Merge: Multica is source of truth for state (e.g. status), on-disk for content if newer
        if (new Date(fileUpdatedAt) > new Date(existing.updatedAt)) {
          const multicaStatus = existing.status;
          Object.assign(existing, parsed);
          // Restore Multica truth
          existing.status = multicaStatus || parsed.status || "todo";
          existing.source = "merged";
          existing.updatedAt = fileUpdatedAt;
        }
      } else {
        storiesMap.set(parsed.id || storyId, {
          id: parsed.id || storyId,
          title: parsed.title || storyId,
          status: parsed.status || "todo",
          ...parsed,
          source: "on-disk",
          updatedAt: fileUpdatedAt
        });
      }
    }
  }

  result.stories = Array.from(storiesMap.values());
  return result;
}
