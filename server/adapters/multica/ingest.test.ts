import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { decideItem } from "../../kb/store.js";
import { itemIdFor, ingestMulticaIssue, ingestMulticaBatch, syncMulticaQueue } from "./ingest.js";
import type { MulticaIssue, MulticaClient } from "./client.js";

function issue(overrides: Partial<MulticaIssue> = {}): MulticaIssue {
  return {
    id: "i-1",
    identifier: "DOS-1",
    title: "Ship v1?",
    description: "body",
    status: "todo",
    priority: null,
    labels: [],
    updatedAt: "2026-08-01T00:00:00Z",
    createdAt: "2026-07-01T00:00:00Z",
    parentId: null,
    ...overrides,
  };
}

describe("itemIdFor", () => {
  it("namespaces a multica issue id so it never collides with other item id spaces", () => {
    expect(itemIdFor("i-1")).toBe("multica:i-1");
  });
});

describe("ingestMulticaIssue", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(() => db.close());

  it("inserts a new item row classified from the issue title", () => {
    const result = ingestMulticaIssue(db, issue({ title: "CBA: which datastore?" }));

    expect(result.itemId).toBe("multica:i-1");
    expect(result.decisionType).toBe("cba");

    const row = db.prepare("SELECT * FROM items WHERE id = ?").get("multica:i-1") as Record<string, unknown>;
    expect(row.title).toBe("CBA: which datastore?");
    expect(row.status).toBe("todo");
    expect(row.source_ref).toBe("DOS-1");
    expect(row.source_body).toBe("body");
  });

  it("upserts on re-ingest — same issue seen twice does not duplicate", () => {
    ingestMulticaIssue(db, issue({ title: "first" }));
    ingestMulticaIssue(db, issue({ title: "second", status: "in_review" }));

    const rows = db.prepare("SELECT * FROM items WHERE id = ?").all("multica:i-1") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("second");
    expect(rows[0].status).toBe("in_review");
  });

  it("re-ingesting a decided item never clears decided_at — the amnesia fix applies to sync too", () => {
    ingestMulticaIssue(db, issue());
    decideItem(db, { itemId: "multica:i-1", actor: "mathew", newStatus: "approved" });

    ingestMulticaIssue(db, issue({ title: "updated title" }));

    const row = db.prepare("SELECT decided_at FROM items WHERE id = ?").get("multica:i-1") as {
      decided_at: string | null;
    };
    expect(row.decided_at).not.toBeNull();
  });
});

describe("ingestMulticaBatch", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(() => db.close());

  it("ingests every issue and reports how many are already decided", () => {
    const result = ingestMulticaBatch(db, [issue({ id: "i-1" }), issue({ id: "i-2" })]);
    expect(result.ingested).toHaveLength(2);
    expect(result.filteredCount).toBe(0);

    decideItem(db, { itemId: "multica:i-1", actor: "mathew", newStatus: "approved" });
    const second = ingestMulticaBatch(db, [issue({ id: "i-1" }), issue({ id: "i-2" })]);
    expect(second.filteredCount).toBe(1);
  });
});

describe("syncMulticaQueue", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(() => db.close());

  function fakeClient(result: Awaited<ReturnType<MulticaClient["listIssues"]>>): MulticaClient {
    return {
      writeComment: async () => ({ ok: false, error: "unused" }),
      listIssues: async () => result,
    };
  }

  it("ingests every issue returned by the client", async () => {
    const client = fakeClient({ ok: true, issues: [issue({ id: "i-1" }), issue({ id: "i-2" })] });

    const result = await syncMulticaQueue(db, client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.ingested).toHaveLength(2);
    const count = db.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'multica:%'").get() as { n: number };
    expect(count.n).toBe(2);
  });

  it("surfaces a client failure rather than silently ingesting nothing", async () => {
    const client = fakeClient({ ok: false, error: "ECONNREFUSED" });

    const result = await syncMulticaQueue(db, client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ECONNREFUSED");
  });
});
