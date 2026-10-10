import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { listInbox, markInboxSeen } from "./query.js";

const CLIENTS = { flayr: "Firefly", venues: "Firefly", consus: "Pantheon", scratch: null };

function insertItem(
  db: Database.Database,
  id: string,
  opts: { repo?: string | null; decision?: boolean; decidedAt?: string | null; status?: string; type?: string; createdAt?: string } = {},
) {
  db.prepare(
    `INSERT INTO items (id, type, title, status, source_repo, decision_payload, decided_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.type ?? (opts.decision ? "decision" : "doc"),
    `Title ${id}`,
    opts.status ?? "active",
    opts.repo === undefined ? null : opts.repo,
    opts.decision ? JSON.stringify({ title: `Title ${id}` }) : null,
    opts.decidedAt ?? null,
    opts.createdAt ?? "2026-10-01T00:00:00.000Z",
    opts.createdAt ?? "2026-10-01T00:00:00.000Z",
  );
}

function insertProposal(db: Database.Database, id: string, itemId: string, status: string, at: string) {
  db.prepare(
    `INSERT INTO proposals (id, item_id, target_type, diff, description, status, requested_by, requested_at)
     VALUES (?, ?, 'doc', 'diff', ?, ?, 'op', ?)`,
  ).run(id, itemId, `Proposal ${id}`, status, at);
}

function insertComment(db: Database.Database, itemId: string, author: string, body: string, at: string) {
  db.prepare("INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)").run(itemId, author, body, at);
}

describe("listInbox", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("lists open questions, pending proposals, and unseen replies with repo and client", () => {
    insertItem(db, "decision:flayr:q1", { repo: "flayr", decision: true, createdAt: "2026-10-02T00:00:00.000Z" });
    insertItem(db, "doc:consus:README.md", { repo: "consus" });
    insertProposal(db, "p1", "doc:consus:README.md", "pending", "2026-10-03T00:00:00.000Z");
    insertItem(db, "diagram:venues", { repo: "venues", type: "diagram" });
    insertComment(db, "diagram:venues", "harness", "Applied, see PR", "2026-10-04T00:00:00.000Z");

    const items = listInbox(db, { clients: CLIENTS });

    expect(items.map((i) => [i.kind, i.itemId, i.repo, i.client])).toEqual([
      ["reply", "diagram:venues", "venues", "Firefly"],
      ["proposal", "doc:consus:README.md", "consus", "Pantheon"],
      ["question", "decision:flayr:q1", "flayr", "Firefly"],
    ]);
    expect(items[0].detail).toBe("harness: Applied, see PR");
    expect(items[1]).toMatchObject({ proposalId: "p1", detail: "Proposal p1", isDecision: false });
    expect(items[2]).toMatchObject({ isDecision: true, title: "Title decision:flayr:q1" });
  });

  it("leaves out decided or closed questions and resolved proposals", () => {
    insertItem(db, "decision:flayr:decided", { repo: "flayr", decision: true, decidedAt: "2026-10-02T00:00:00.000Z" });
    insertItem(db, "decision:flayr:closed", { repo: "flayr", decision: true, status: "closed" });
    insertItem(db, "doc:flayr:a.md", { repo: "flayr" });
    insertProposal(db, "applied", "doc:flayr:a.md", "applied", "2026-10-02T00:00:00.000Z");
    insertProposal(db, "failed", "doc:flayr:a.md", "failed", "2026-10-02T00:00:00.000Z");

    expect(listInbox(db, { clients: CLIENTS })).toEqual([]);
  });

  it("drops a reply once seen and brings it back when a newer comment arrives", () => {
    insertItem(db, "doc:flayr:a.md", { repo: "flayr" });
    insertComment(db, "doc:flayr:a.md", "harness", "first", "2026-10-02T00:00:00.000Z");
    expect(listInbox(db, { clients: CLIENTS }).map((i) => i.kind)).toEqual(["reply"]);

    markInboxSeen(db, "doc:flayr:a.md", "2026-10-02T00:00:01.000Z");
    expect(listInbox(db, { clients: CLIENTS })).toEqual([]);

    insertComment(db, "doc:flayr:a.md", "harness", "second", "2026-10-03T00:00:00.000Z");
    const items = listInbox(db, { clients: CLIENTS });
    expect(items).toHaveLength(1);
    expect(items[0].detail).toBe("harness: second");
  });

  it("never moves a seen mark backwards", () => {
    insertItem(db, "doc:flayr:a.md", { repo: "flayr" });
    insertComment(db, "doc:flayr:a.md", "harness", "x", "2026-10-02T00:00:00.000Z");
    markInboxSeen(db, "doc:flayr:a.md", "2026-10-05T00:00:00.000Z");
    markInboxSeen(db, "doc:flayr:a.md", "2026-10-01T00:00:00.000Z");
    expect(listInbox(db, { clients: CLIENTS })).toEqual([]);
  });

  it("filters to one client, and gives unregistered or repo-less items no client", () => {
    insertItem(db, "decision:flayr:q", { repo: "flayr", decision: true });
    insertItem(db, "decision:consus:q", { repo: "consus", decision: true });
    insertItem(db, "decision:scratch:q", { repo: "scratch", decision: true });
    insertItem(db, "decision:gone:q", { repo: "gone", decision: true });
    insertItem(db, "question:PANT-1:q1", { repo: null, decision: true });

    expect(listInbox(db, { clients: CLIENTS, client: "Firefly" }).map((i) => i.itemId)).toEqual(["decision:flayr:q"]);

    const all = listInbox(db, { clients: CLIENTS });
    expect(all).toHaveLength(5);
    const clientOf = Object.fromEntries(all.map((i) => [i.itemId, i.client]));
    expect(clientOf["decision:scratch:q"]).toBeNull();
    expect(clientOf["decision:gone:q"]).toBeNull();
    expect(clientOf["question:PANT-1:q1"]).toBeNull();
  });
});

function insertThreadMessage(
  db: Database.Database,
  threadId: string,
  item: { type: string; id: string },
  role: "operator" | "agent",
  body: string,
  at: string,
) {
  db.prepare(
    `INSERT OR IGNORE INTO threads (id, item_type, item_id, anchor, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)`,
  ).run(threadId, item.type, item.id, at, at);
  db.prepare(
    `INSERT INTO thread_messages (thread_id, role, author, body, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(threadId, role, role === "agent" ? "builder-agent" : "operator", body, at);
}

describe("listInbox — agent threads (PANT-962)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  it("lists a thread whose last message is an agent reply, with the item's repo and client", () => {
    insertItem(db, "doc:flayr:a.md", { repo: "flayr" });
    insertThreadMessage(db, "t1", { type: "doc", id: "doc:flayr:a.md" }, "operator", "Why?", "2026-10-02T00:00:00.000Z");
    insertThreadMessage(db, "t1", { type: "doc", id: "doc:flayr:a.md" }, "agent", "Because", "2026-10-03T00:00:00.000Z");

    const items = listInbox(db, { clients: CLIENTS });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "reply",
      key: "reply:thread:t1",
      itemId: "doc:flayr:a.md",
      itemType: "doc",
      repo: "flayr",
      client: "Firefly",
      detail: "builder-agent: Because",
      at: "2026-10-03T00:00:00.000Z",
    });
    expect(listInbox(db, { clients: CLIENTS, client: "Pantheon" })).toEqual([]);
  });

  it("leaves out a thread still waiting on the agent, or answered by the operator since", () => {
    insertItem(db, "doc:flayr:a.md", { repo: "flayr" });
    insertThreadMessage(db, "waiting", { type: "doc", id: "doc:flayr:a.md" }, "operator", "Q", "2026-10-02T00:00:00.000Z");
    insertThreadMessage(db, "answered", { type: "doc", id: "doc:flayr:a.md" }, "agent", "A", "2026-10-02T00:00:00.000Z");
    insertThreadMessage(db, "answered", { type: "doc", id: "doc:flayr:a.md" }, "operator", "Thanks", "2026-10-03T00:00:00.000Z");

    expect(listInbox(db, { clients: CLIENTS })).toEqual([]);
  });

  it("clears once the item is seen and returns on a newer agent reply", () => {
    insertItem(db, "decision:flayr:q", { repo: "flayr", decision: true, decidedAt: "2026-10-01T00:00:00.000Z" });
    insertThreadMessage(db, "t1", { type: "decision", id: "decision:flayr:q" }, "agent", "first", "2026-10-02T00:00:00.000Z");
    expect(listInbox(db, { clients: CLIENTS }).map((i) => [i.kind, i.isDecision])).toEqual([["reply", true]]);

    markInboxSeen(db, "decision:flayr:q", "2026-10-02T00:00:01.000Z");
    expect(listInbox(db, { clients: CLIENTS })).toEqual([]);

    insertThreadMessage(db, "t1", { type: "decision", id: "decision:flayr:q" }, "agent", "second", "2026-10-03T00:00:00.000Z");
    expect(listInbox(db, { clients: CLIENTS }).map((i) => i.detail)).toEqual(["builder-agent: second"]);
  });

  it("falls back to the item id when the thread's item has no items row", () => {
    insertThreadMessage(db, "t1", { type: "proposal", id: "proposal-123" }, "agent", "done", "2026-10-02T00:00:00.000Z");
    expect(listInbox(db, { clients: CLIENTS })[0]).toMatchObject({
      title: "proposal-123",
      repo: null,
      client: null,
      isDecision: false,
    });
  });
});

describe("inbox_seen migration backfill", () => {
  it("marks every pre-existing thread seen the first time the table is created", () => {
    const db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "doc:flayr:a.md", { repo: "flayr" });
    insertComment(db, "doc:flayr:a.md", "harness", "old", "2026-10-02T00:00:00.000Z");
    // Simulate a database from before PANT-960.
    db.exec("DROP TABLE inbox_seen");

    runMigration(db);
    expect(listInbox(db, { clients: CLIENTS })).toEqual([]);

    // Pre-existing agent thread replies are backfilled as seen too.
    db.exec("DROP TABLE inbox_seen");
    insertThreadMessage(db, "t-old", { type: "doc", id: "doc:flayr:a.md" }, "agent", "old", "2026-10-02T12:00:00.000Z");
    runMigration(db);
    expect(listInbox(db, { clients: CLIENTS })).toEqual([]);

    // Re-running the migration does not re-backfill over newer comments.
    insertComment(db, "doc:flayr:a.md", "harness", "new", "2026-10-03T00:00:00.000Z");
    runMigration(db);
    expect(listInbox(db, { clients: CLIENTS }).map((i) => i.kind)).toEqual(["reply"]);
  });
});
