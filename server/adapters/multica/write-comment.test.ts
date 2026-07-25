import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { writeCommentAndCache } from "./write-comment.js";
import type { MulticaClient } from "./client.js";

function insertItem(db: Database.Database, id: string) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", "Test item", "open", now, now);
}

describe("writeCommentAndCache", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");
  });

  it("writes to Multica first, then caches locally with the returned multica_comment_id", async () => {
    const client: MulticaClient = {
      async writeComment() {
        return { ok: true, multicaCommentId: "mc-1" };
      },
    };

    const result = await writeCommentAndCache(db, client, { itemId: "item-1", author: "mathew", body: "hi" });

    expect(result.ok).toBe(true);
    const row = db.prepare("SELECT * FROM comments WHERE item_id = ?").get("item-1") as {
      multica_comment_id: string;
      body: string;
    };
    expect(row.multica_comment_id).toBe("mc-1");
    expect(row.body).toBe("hi");
  });

  it("surfaces a clear failure and does NOT write locally when Multica is unreachable", async () => {
    const client: MulticaClient = {
      async writeComment() {
        return { ok: false, error: "ECONNREFUSED" };
      },
    };

    const result = await writeCommentAndCache(db, client, { itemId: "item-1", author: "mathew", body: "hi" });

    expect(result.ok).toBe(false);
    const rows = db.prepare("SELECT * FROM comments WHERE item_id = ?").all("item-1");
    expect(rows).toHaveLength(0);
  });
});
