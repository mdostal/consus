import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { decideItem } from "../../kb/store.js";
import {
  ingestMulticaIssue,
  ingestMulticaBatch,
  listActiveMulticaQueue,
  itemIdFor,
  syncMulticaQueue,
} from "./ingest.js";
import type { MulticaClient, MulticaIssue } from "./client.js";

function makeIssue(overrides: Partial<MulticaIssue> = {}): MulticaIssue {
  return {
    id: "issue-1",
    identifier: "MUL-1",
    title: "Some issue",
    description: null,
    status: "in_review",
    priority: "none",
    labels: [],
    updatedAt: null,
    createdAt: null,
    ...overrides,
  };
}

describe("Multica issue ingest", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("ingests a Multica issue as an item, classified via the decision-contract heuristic", () => {
    const result = ingestMulticaIssue(
      db,
      makeIssue({ id: "issue-cba", title: "CBA: build vs buy the queue" }),
    );

    expect(result.itemId).toBe(itemIdFor("issue-cba"));
    expect(result.decisionType).toBe("cba");
    expect(result.triageBucket).toBe("open_question");

    const row = db.prepare("SELECT type, title, decision_type, triage_bucket FROM items WHERE id = ?").get(
      result.itemId,
    );
    expect(row).toMatchObject({
      type: "multica_issue",
      title: "CBA: build vs buy the queue",
      decision_type: "cba",
      triage_bucket: "open_question",
    });
  });

  it("assigns triage_bucket agent_task for a plain, non-decision-shaped title", () => {
    const result = ingestMulticaIssue(db, makeIssue({ id: "issue-plain", title: "Fix the flaky test" }));

    expect(result.decisionType).toBe("default");
    expect(result.triageBucket).toBe("agent_task");
  });

  it("re-ingesting the same issue updates title/status but preserves an existing decided_at", () => {
    const { itemId } = ingestMulticaIssue(db, makeIssue({ id: "issue-decided", title: "Choose the layout" }));
    decideItem(db, { itemId, actor: "mathew", newStatus: "done" });

    const before = db.prepare("SELECT decided_at FROM items WHERE id = ?").get(itemId) as { decided_at: string };
    expect(before.decided_at).toBeTruthy();

    ingestMulticaIssue(db, makeIssue({ id: "issue-decided", title: "Choose the layout (updated)", status: "done" }));

    const after = db.prepare("SELECT title, decided_at FROM items WHERE id = ?").get(itemId) as {
      title: string;
      decided_at: string;
    };
    expect(after.title).toBe("Choose the layout (updated)");
    expect(after.decided_at).toBe(before.decided_at);
  });

  it("processes a batch of ~200 issues without timing out, classifying every one", () => {
    const issues = Array.from({ length: 200 }, (_, i) => makeIssue({ id: `bulk-${i}`, title: `Task number ${i}` }));

    const start = performance.now();
    const { ingested, filteredCount } = ingestMulticaBatch(db, issues);
    const elapsedMs = performance.now() - start;

    expect(ingested).toHaveLength(200);
    expect(filteredCount).toBe(0);
    expect(elapsedMs).toBeLessThan(5_000);

    const count = db.prepare("SELECT COUNT(*) AS n FROM items WHERE type = 'multica_issue'").get() as {
      n: number;
    };
    expect(count.n).toBe(200);
  });

  it("filters an already-decided issue out of the active queue (decided-store filtering)", () => {
    const { itemId: openId } = ingestMulticaIssue(db, makeIssue({ id: "issue-open", title: "Pick one option" }));
    const { itemId: decidedId } = ingestMulticaIssue(
      db,
      makeIssue({ id: "issue-decided-2", title: "Survey the team" }),
    );
    decideItem(db, { itemId: decidedId, actor: "mathew", newStatus: "done" });

    const active = listActiveMulticaQueue(db);
    const activeIds = active.map((i) => i.itemId);

    expect(activeIds).toContain(openId);
    expect(activeIds).not.toContain(decidedId);
  });

  it("filters already-decided issues out of a freshly ingested batch", () => {
    const { itemId: decidedId } = ingestMulticaIssue(db, makeIssue({ id: "issue-batch-decided" }));
    decideItem(db, { itemId: decidedId, actor: "mathew", newStatus: "done" });

    const { filteredCount } = ingestMulticaBatch(db, [makeIssue({ id: "issue-batch-decided" })]);

    expect(filteredCount).toBe(1);
    expect(listActiveMulticaQueue(db).map((i) => i.itemId)).not.toContain(decidedId);
  });
});

describe("syncMulticaQueue", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  function fakeClient(issues: MulticaIssue[]): MulticaClient {
    return {
      async writeComment() {
        return { ok: true, multicaCommentId: "unused" };
      },
      async listIssues() {
        return { ok: true, issues };
      },
    };
  }

  it("fetches from the client and ingests the returned batch", async () => {
    const client = fakeClient([makeIssue({ id: "synced-1", title: "Weekly ops report" })]);

    const result = await syncMulticaQueue(db, client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.ingested).toHaveLength(1);
      expect(result.result.ingested[0].decisionType).toBe("edit");
    }
  });

  it("surfaces a fetch failure rather than silently ingesting nothing", async () => {
    const client: MulticaClient = {
      async writeComment() {
        return { ok: true, multicaCommentId: "unused" };
      },
      async listIssues() {
        return { ok: false, error: "Multica returned HTTP 500" };
      },
    };

    const result = await syncMulticaQueue(db, client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("500");
    }
  });
});
