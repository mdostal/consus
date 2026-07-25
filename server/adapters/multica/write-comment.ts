import type Database from "better-sqlite3";
import type { MulticaClient, WriteCommentInput } from "./client.js";

export type WriteCommentAndCacheResult = { ok: true } | { ok: false; error: string };

/**
 * REQ-07: comment writes go through Multica, not a Delphi-private store.
 * Writes to Multica first; only on success does the comment get cached
 * locally (with the returned multica_comment_id) for fast local reads. On
 * failure, nothing is written locally — the caller gets a clear failure,
 * never a silently-dropped write or a false success.
 */
export async function writeCommentAndCache(
  db: Database.Database,
  client: MulticaClient,
  input: WriteCommentInput,
): Promise<WriteCommentAndCacheResult> {
  const result = await client.writeComment(input);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  db.prepare(
    "INSERT INTO comments (item_id, author, body, created_at, multica_comment_id) VALUES (?, ?, ?, ?, ?)",
  ).run(input.itemId, input.author, input.body, new Date().toISOString(), result.multicaCommentId);

  return { ok: true };
}
