import type Database from "better-sqlite3";
import { queryDocIndex, type DocIndexRow } from "../../adapters/doc-scanner/index.js";
import type { MulticaClient } from "../../adapters/multica/client.js";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { parseYaml } from "../../lib/yaml-parser.js";

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
  type: string;
  title: string;
  content: string | Record<string, any>;
  provenance: "multica" | "disk";
}

function getDiskDocs(repoPath: string, epicId: string): EpicDoc[] {
  const docs: EpicDoc[] = [];
  const epicsDir = join(repoPath, ".pHive", "epics", epicId);
  if (!existsSync(epicsDir)) return [];

  const docsDir = join(epicsDir, "docs");
  if (existsSync(docsDir)) {
    for (const file of readdirSync(docsDir)) {
      if (file.endsWith(".md")) {
        const type = file.replace(".md", "");
        const content = readFileSync(join(docsDir, file), "utf-8");
        docs.push({ id: file, type, title: type, content, provenance: "disk" });
      }
    }
  }

  const storiesDir = join(epicsDir, "stories");
  if (existsSync(storiesDir)) {
    for (const file of readdirSync(storiesDir)) {
      if (file.endsWith(".yaml")) {
        const content = readFileSync(join(storiesDir, file), "utf-8");
        const parsed = parseYaml(content);
        if (parsed) {
          docs.push({ 
            id: parsed.id || file, 
            type: "story", 
            title: parsed.title || file, 
            content: parsed, 
            provenance: "disk" 
          });
        }
      }
    }
  }

  return docs;
}

async function getMulticaDocs(client: MulticaClient, epicId: string): Promise<EpicDoc[] | null> {
  const epicRes = await client.getIssue(epicId);
  if (!epicRes.ok) return null;

  const docs: EpicDoc[] = [];
  const epic = epicRes.issue;
  
  docs.push({
    id: epic.id,
    type: "epic",
    title: epic.title,
    content: epic.description || "",
    provenance: "multica"
  });

  if (true) {
    const commentsRes = await (client as any).getIssueComments(epic.id);
    if (commentsRes.ok) {
      for (const c of commentsRes.comments) {
        docs.push({
          id: c.id,
          type: "comment",
          title: `Comment by ${c.author}`,
          content: c.body,
          provenance: "multica"
        });
      }
    }
  }

  if (true) {
    const childrenRes = await (client as any).getIssueChildren(epic.id);
    if (childrenRes.ok) {
      for (const child of childrenRes.issues) {
        let type = "story";
        const normalizedTitle = child.title.toLowerCase().replace(/ /g, '-');
        if (["design-discussion", "research-brief", "structured-outline"].includes(normalizedTitle)) {
          type = normalizedTitle;
        } else if (child.labels && child.labels.some((l: string) => ["design-discussion", "research-brief", "structured-outline"].includes(l))) {
           type = child.labels.find((l: string) => ["design-discussion", "research-brief", "structured-outline"].includes(l)) || type;
        }

        docs.push({
          id: child.id,
          type,
          title: child.title,
          content: child.description || "",
          provenance: "multica"
        });
      }
    }
  }

  return docs;
}

export async function composeEpicDocs(epicId: string, client: MulticaClient, repoPath: string = process.cwd()): Promise<EpicDoc[] | null> {
  const diskDocs = getDiskDocs(repoPath, epicId);
  const multicaDocs = await getMulticaDocs(client, epicId);

  if (diskDocs.length === 0 && !multicaDocs) {
    return null;
  }

  const merged = new Map<string, EpicDoc>();

  for (const d of diskDocs) {
    const key = d.type === 'story' ? `story:${d.id}` : d.type;
    merged.set(key, d);
  }

  if (multicaDocs) {
    for (const m of multicaDocs) {
      const key = m.type === 'story' ? `story:${m.id}` : (["epic", "comment"].includes(m.type) ? `${m.type}:${m.id}` : m.type);
      merged.set(key, m);
    }
  }

  return Array.from(merged.values());
}
