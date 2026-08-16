import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { createEvent, listEvents, updateEventStatus, getEvent, type EventRow } from "./store.js";

function insertItem(db: Database.Database, id: string) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", "Test item", "open", now, now);
}

function baseInput(overrides: Partial<Parameters<typeof createEvent>[1]> = {}) {
  return {
    project: "proj-a",
    triggerKind: "doc_changed" as const,
    sourceRepo: "org/repo",
    sourcePath: "docs/foo.md",
    contentHash: "hash-1",
    composedPrompt: "prompt text",
    ...overrides,
  };
}

/** Direct SQL insert (bypassing createEvent) so tests can control
 *  project/status/detected_at precisely, e.g. for sort-order assertions
 *  where createEvent's real-clock `now` timestamps could collide. */
function insertRawEvent(
  db: Database.Database,
  fields: {
    id: string;
    project?: string;
    status?: "new" | "in_progress" | "done" | "dismissed";
    detectedAt?: string;
    statusUpdatedAt?: string;
    archivedAt?: string | null;
  },
) {
  const {
    id,
    project = "proj-a",
    status = "new",
    detectedAt = "2026-07-25T00:00:00.000Z",
    statusUpdatedAt = detectedAt,
    archivedAt = null,
  } = fields;
  db.prepare(
    `INSERT INTO events (id, project, trigger_kind, source_repo, source_path, content_hash, composed_prompt, status, detected_at, status_updated_at, archived_at)
     VALUES (?, ?, 'doc_changed', 'org/repo', 'docs/foo.md', 'hash', 'prompt', ?, ?, ?, ?)`,
  ).run(id, project, status, detectedAt, statusUpdatedAt, archivedAt);
}

describe("events/store", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  describe("createEvent", () => {
    it("returns an EventRow with a generated id, status 'new', matching detected_at/status_updated_at, and null archived_at/proposal_id", () => {
      const row = createEvent(db, baseInput());

      expect(row.id).toBeTruthy();
      expect(row.status).toBe("new");
      expect(row.detected_at).toBeTruthy();
      expect(row.status_updated_at).toBe(row.detected_at);
      expect(row.archived_at).toBeNull();
      expect(row.proposal_id).toBeNull();
      expect(row.project).toBe("proj-a");
      expect(row.trigger_kind).toBe("doc_changed");
      expect(row.source_repo).toBe("org/repo");
      expect(row.source_path).toBe("docs/foo.md");
      expect(row.content_hash).toBe("hash-1");
      expect(row.composed_prompt).toBe("prompt text");
      expect(row.previous_hash).toBeNull();
      expect(row.diff).toBeNull();
      expect(row.item_id).toBeNull();

      const persisted = db.prepare("SELECT * FROM events WHERE id = ?").get(row.id) as EventRow;
      expect(persisted).toBeDefined();
      expect(persisted.status).toBe("new");
    });

    it("persists optional fields (previousHash, diff, itemId) when supplied", () => {
      insertItem(db, "item-1");
      const row = createEvent(
        db,
        baseInput({
          triggerKind: "decision_needed",
          previousHash: "hash-0",
          diff: "+ line",
          itemId: "item-1",
        }),
      );

      expect(row.trigger_kind).toBe("decision_needed");
      expect(row.previous_hash).toBe("hash-0");
      expect(row.diff).toBe("+ line");
      expect(row.item_id).toBe("item-1");
    });
  });

  describe("listEvents", () => {
    it("returns all events across projects/statuses with no filters, excluding archived by default (none archived here)", () => {
      insertRawEvent(db, { id: "e1", project: "proj-a", status: "new" });
      insertRawEvent(db, { id: "e2", project: "proj-b", status: "in_progress" });
      insertRawEvent(db, { id: "e3", project: "proj-a", status: "done" });

      const rows = listEvents(db);

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.id).sort()).toEqual(["e1", "e2", "e3"]);
    });

    it("excludes archived events by default, and returns only archived events when archived: true", () => {
      insertRawEvent(db, { id: "e1", status: "new", archivedAt: null });
      insertRawEvent(db, { id: "e2", status: "done", archivedAt: "2026-07-25T01:00:00.000Z" });

      const defaultRows = listEvents(db);
      expect(defaultRows.map((r) => r.id)).toEqual(["e1"]);

      const archivedRows = listEvents(db, { archived: true });
      expect(archivedRows.map((r) => r.id)).toEqual(["e2"]);
    });

    it("sorts by detected_at ascending and descending", () => {
      insertRawEvent(db, { id: "e1", detectedAt: "2026-07-25T00:00:00.000Z" });
      insertRawEvent(db, { id: "e2", detectedAt: "2026-07-25T02:00:00.000Z" });
      insertRawEvent(db, { id: "e3", detectedAt: "2026-07-25T01:00:00.000Z" });

      expect(listEvents(db, { sort: "detected_at", order: "asc" }).map((r) => r.id)).toEqual(["e1", "e3", "e2"]);
      expect(listEvents(db, { sort: "detected_at", order: "desc" }).map((r) => r.id)).toEqual(["e2", "e3", "e1"]);
    });

    it("sorts by status ascending and descending", () => {
      insertRawEvent(db, { id: "e1", status: "new" });
      insertRawEvent(db, { id: "e2", status: "in_progress" });
      insertRawEvent(db, { id: "e3", status: "dismissed" });

      const asc = listEvents(db, { sort: "status", order: "asc" }).map((r) => r.status);
      const desc = listEvents(db, { sort: "status", order: "desc" }).map((r) => r.status);
      expect(asc).toEqual([...asc].sort());
      expect(desc).toEqual([...desc].sort().reverse());
    });

    it("sorts by project ascending and descending", () => {
      insertRawEvent(db, { id: "e1", project: "zeta" });
      insertRawEvent(db, { id: "e2", project: "alpha" });
      insertRawEvent(db, { id: "e3", project: "mid" });

      expect(listEvents(db, { sort: "project", order: "asc" }).map((r) => r.id)).toEqual(["e2", "e3", "e1"]);
      expect(listEvents(db, { sort: "project", order: "desc" }).map((r) => r.id)).toEqual(["e1", "e3", "e2"]);
    });

    it("rejects sort/order values outside the fixed allow-list rather than interpolating them into SQL", () => {
      insertRawEvent(db, { id: "e1" });

      expect(() => listEvents(db, { sort: "1; DROP TABLE events; --" as unknown as "project" })).toThrow();
      expect(() => listEvents(db, { order: "asc; DROP TABLE events; --" as unknown as "asc" })).toThrow();

      // The table must still exist and be queryable afterward.
      expect(listEvents(db)).toHaveLength(1);
    });

    it("filters by project and/or status, returning only rows matching every supplied filter", () => {
      insertRawEvent(db, { id: "e1", project: "foo", status: "in_progress" });
      insertRawEvent(db, { id: "e2", project: "foo", status: "new" });
      insertRawEvent(db, { id: "e3", project: "bar", status: "in_progress" });

      expect(listEvents(db, { project: "foo" }).map((r) => r.id).sort()).toEqual(["e1", "e2"]);
      expect(listEvents(db, { status: "in_progress" }).map((r) => r.id).sort()).toEqual(["e1", "e3"]);
      expect(listEvents(db, { project: "foo", status: "in_progress" }).map((r) => r.id)).toEqual(["e1"]);
    });
  });

  describe("updateEventStatus", () => {
    it("moves 'new' -> 'in_progress': bumps status_updated_at, leaves archived_at null", async () => {
      const created = createEvent(db, baseInput());
      await new Promise((r) => setTimeout(r, 2));

      const updated = updateEventStatus(db, created.id, "in_progress");

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("in_progress");
      expect(updated!.archived_at).toBeNull();
      expect(updated!.status_updated_at).not.toBe(created.status_updated_at);
    });

    it("moves 'new' -> 'done': sets archived_at to a non-null timestamp and bumps status_updated_at", async () => {
      const created = createEvent(db, baseInput());
      await new Promise((r) => setTimeout(r, 2));

      const updated = updateEventStatus(db, created.id, "done");

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("done");
      expect(updated!.archived_at).not.toBeNull();
      expect(updated!.status_updated_at).not.toBe(created.status_updated_at);
    });

    it("clears archived_at when moving an already-archived ('dismissed') event back to 'in_progress'", async () => {
      const created = createEvent(db, baseInput());
      updateEventStatus(db, created.id, "dismissed");
      const dismissed = getEvent(db, created.id)!;
      expect(dismissed.archived_at).not.toBeNull();

      await new Promise((r) => setTimeout(r, 2));
      const updated = updateEventStatus(db, created.id, "in_progress");

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("in_progress");
      expect(updated!.archived_at).toBeNull();
    });

    it("returns null and does not throw or modify any row for an unknown id", () => {
      createEvent(db, baseInput());
      const before = db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };

      const result = updateEventStatus(db, "does-not-exist", "done");

      expect(result).toBeNull();
      const after = db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
      expect(after.n).toBe(before.n);
    });
  });

  describe("getEvent", () => {
    it("returns the full matching EventRow for an existing id", () => {
      const created = createEvent(db, baseInput());

      const found = getEvent(db, created.id);

      expect(found).toEqual(created);
    });

    it("returns undefined for a non-existent id", () => {
      expect(getEvent(db, "does-not-exist")).toBeUndefined();
    });
  });
});
