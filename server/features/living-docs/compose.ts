import type Database from "better-sqlite3";
import { queryDocIndex, type DocIndexRow } from "../../adapters/doc-scanner/index.js";

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

/**
 * REQ-10 (P1 stretch): Delphi's own rendered overlay, composing references
 * from Multica (via the local comments cache) + .pHive/planning (via the
 * Doc Scanner) + the idea board. An overlay, not a copy of Multica's
 * board/task-state schema — it carries no board/task fields, only
 * references + rendering.
 *
 * SCOPE NOTE (flagged, not silently dropped): the idea board integration
 * point has no confirmed local spec as of this implementation pass — this
 * composer ships with the two confirmed sources (docs + comments) and
 * explicitly flags the idea board as unavailable, per this story's own
 * risk note, rather than fabricating an integration or silently omitting
 * the field.
 */
export function composeLivingDoc(db: Database.Database, { repoName, repoPath, itemId }: ComposeLivingDocOptions): LivingDocView {
  void repoPath; // reserved: future doc-content resolution reads from here

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
