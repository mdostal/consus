import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { runMigration } from "../server/db/migrate.js";
import { registerDecisionRoutes } from "../server/routes/decisions.js";
import type { MulticaClient } from "../server/adapters/multica/client.js";
import {
  ITEM_ID_PREFIX,
  parseAuditLog,
  groupDecidedItems,
  migrateDecidedItems,
  runCli,
  type CliOptions,
} from "./migrate-claud-ometer-decided-store.js";

function entry(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    ts: "2026-07-20T22:41:00.593Z",
    actor: "you",
    itemId: "bea4f2c5-d9a7-4737-854e-c0acfe2fed8a",
    identifier: "DOS-741",
    action: "approve",
    statusFrom: "in_review",
    statusTo: "done",
    rationale: "Chosen: Approve — ship it.",
    version: 1,
    ...overrides,
  });
}

describe("parseAuditLog", () => {
  it("parses one JSON object per line", () => {
    const jsonl = [entry({ itemId: "a" }), entry({ itemId: "b" })].join("\n");
    const { entries, malformedLines } = parseAuditLog(jsonl);
    expect(entries).toHaveLength(2);
    expect(malformedLines).toHaveLength(0);
  });

  it("skips malformed lines instead of throwing, and reports them", () => {
    const jsonl = [entry({ itemId: "a" }), "not json at all", '{"itemId": "missing-fields"}'].join("\n");
    const { entries, malformedLines } = parseAuditLog(jsonl);
    expect(entries).toHaveLength(1);
    expect(malformedLines).toHaveLength(2);
    expect(malformedLines[0].line).toBe(2);
    expect(malformedLines[1].line).toBe(3);
  });

  it("ignores blank lines", () => {
    const jsonl = `${entry({ itemId: "a" })}\n\n\n${entry({ itemId: "b" })}\n`;
    const { entries, malformedLines } = parseAuditLog(jsonl);
    expect(entries).toHaveLength(2);
    expect(malformedLines).toHaveLength(0);
  });
});

describe("groupDecidedItems", () => {
  it("keeps the highest-version entry per itemId as the final decision", () => {
    const entries = parseAuditLog(
      [
        entry({ itemId: "x", version: 1, action: "decide-defer", statusTo: null }),
        entry({ itemId: "x", version: 2, action: "approve", statusTo: "done" }),
      ].join("\n"),
    ).entries;

    const [decision] = groupDecidedItems(entries);
    expect(decision.id).toBe(`${ITEM_ID_PREFIX}x`);
    expect(decision.final.action).toBe("approve");
    expect(decision.history).toHaveLength(2);
  });

  it("collapses duplicate lines (same itemId + version) into a single history entry", () => {
    const entries = parseAuditLog(
      [entry({ itemId: "x", version: 1 }), entry({ itemId: "x", version: 1 })].join("\n"),
    ).entries;

    const [decision] = groupDecidedItems(entries);
    expect(decision.history).toHaveLength(1);
  });

  it("produces one decided item per unique itemId", () => {
    const entries = parseAuditLog(
      [entry({ itemId: "a" }), entry({ itemId: "b" }), entry({ itemId: "c" })].join("\n"),
    ).entries;

    expect(groupDecidedItems(entries)).toHaveLength(3);
  });
});

describe("migrateDecidedItems", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts N rows into items for N decided items", () => {
    const entries = parseAuditLog(
      [entry({ itemId: "a" }), entry({ itemId: "b" }), entry({ itemId: "c" })].join("\n"),
    ).entries;
    const decisions = groupDecidedItems(entries);

    const summary = migrateDecidedItems(db, decisions);

    expect(summary.inserted).toBe(3);
    const count = db.prepare("SELECT COUNT(*) as c FROM items").get() as { c: number };
    expect(count.c).toBe(3);
  });

  it("writes full version history into audit_log, not just the final decision", () => {
    const entries = parseAuditLog(
      [
        entry({ itemId: "x", version: 1, action: "decide-defer", statusTo: null, rationale: "hold" }),
        entry({ itemId: "x", version: 2, action: "approve", statusTo: "done", rationale: "ship it" }),
      ].join("\n"),
    ).entries;

    migrateDecidedItems(db, groupDecidedItems(entries));

    const rows = db
      .prepare("SELECT * FROM audit_log WHERE item_id = ? ORDER BY timestamp ASC")
      .all(`${ITEM_ID_PREFIX}x`) as Array<{ old_value: string | null; new_value: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ old_value: "in_review", new_value: "decide-defer" });
    expect(rows[1]).toMatchObject({ old_value: "in_review", new_value: "done" });
  });

  it("is idempotent — re-running does not duplicate rows", () => {
    const entries = parseAuditLog([entry({ itemId: "a" }), entry({ itemId: "b" })].join("\n")).entries;
    const decisions = groupDecidedItems(entries);

    const first = migrateDecidedItems(db, decisions);
    const second = migrateDecidedItems(db, decisions);

    expect(first.inserted).toBe(2);
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(2);

    const count = db.prepare("SELECT COUNT(*) as c FROM items").get() as { c: number };
    expect(count.c).toBe(2);
    const auditCount = db.prepare("SELECT COUNT(*) as c FROM audit_log").get() as { c: number };
    expect(auditCount.c).toBe(2);
  });

  it("sets decided_at so the item is a decided item, not an open one", () => {
    const entries = parseAuditLog(entry({ itemId: "a" })).entries;
    migrateDecidedItems(db, groupDecidedItems(entries));

    const row = db.prepare("SELECT decided_at, decision_payload FROM items WHERE id = ?").get(`${ITEM_ID_PREFIX}a`) as {
      decided_at: string | null;
      decision_payload: string;
    };
    expect(row.decided_at).not.toBeNull();
    const payload = JSON.parse(row.decision_payload);
    expect(payload.migratedFrom).toBe("claud-ometer-delphi");
  });
});

/** Fake MulticaClient with no issues — the live-sync step in registerDecisionRoutes
 *  runs and finds nothing, leaving only the items this test migrates in directly. */
const EMPTY_CLIENT: MulticaClient = {
  async writeComment() {
    return { ok: true, multicaCommentId: "unused" };
  },
  async listIssues() {
    return { ok: true, issues: [] };
  },
  async getIssue() {
    return {
      ok: true,
      issue: {
        id: "issue-1",
        identifier: "MUL-1",
        title: "Unused",
        description: null,
        status: "open",
        priority: null,
        labels: [],
        updatedAt: null,
        createdAt: null,
      },
    };
  },
  async updateIssueStatus(_issueId: string, status: string) {
    return { ok: true, status };
  },
};

describe("GET /api/decisions after migration", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerDecisionRoutes(app, { db, client: EMPTY_CLIENT });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("excludes a migrated decided item from the default (open-only) list", async () => {
    const entries = parseAuditLog(entry({ itemId: "decided-1" })).entries;
    migrateDecidedItems(db, groupDecidedItems(entries));

    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    const body = res.json();
    expect(body.map((i: { id: string }) => i.id)).not.toContain(`${ITEM_ID_PREFIX}decided-1`);
  });

  it("includes a migrated decided item under ?all=1 with a non-null decided_at", async () => {
    const entries = parseAuditLog(entry({ itemId: "decided-2" })).entries;
    migrateDecidedItems(db, groupDecidedItems(entries));

    const res = await app.inject({ method: "GET", url: "/api/decisions?all=1" });
    const body = res.json();
    const migrated = body.find((i: { id: string }) => i.id === `${ITEM_ID_PREFIX}decided-2`);
    expect(migrated).toBeDefined();
    expect(migrated.decided_at).not.toBeNull();
  });
});

describe("runCli", () => {
  let dir: string;
  let jsonlPath: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "delphi-migration-test-"));
    jsonlPath = join(dir, "delphi-audit.jsonl");
    dbPath = join(dir, "consus.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function options(overrides: Partial<CliOptions> = {}): CliOptions {
    return { jsonlPath, dbPath, dryRun: false, archive: true, ...overrides };
  }

  it("inserts rows and leaves the original file archived, not deleted", () => {
    writeFileSync(jsonlPath, [entry({ itemId: "a" }), entry({ itemId: "b" })].join("\n") + "\n");

    const result = runCli(options());

    expect(result.summary?.inserted).toBe(2);
    expect(existsSync(jsonlPath)).toBe(false); // renamed, not present at original path
    expect(result.archivedTo).not.toBeNull();
    expect(existsSync(result.archivedTo!)).toBe(true);
    const archivedContent = readFileSync(result.archivedTo!, "utf-8");
    expect(archivedContent).toContain('"itemId":"a"');
  });

  it("dry-run mode makes no database or filesystem changes", () => {
    writeFileSync(jsonlPath, entry({ itemId: "a" }) + "\n");

    const result = runCli(options({ dryRun: true }));

    expect(result.summary).toBeNull();
    expect(existsSync(jsonlPath)).toBe(true);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("reports a clear error when the source file is missing", () => {
    const result = runCli(options({ jsonlPath: join(dir, "does-not-exist.jsonl") }));
    expect(result.error).toMatch(/No such file/);
  });

  it("--no-archive leaves the source file in place after a real migration", () => {
    writeFileSync(jsonlPath, entry({ itemId: "a" }) + "\n");

    const result = runCli(options({ archive: false }));

    expect(result.summary?.inserted).toBe(1);
    expect(result.archivedTo).toBeNull();
    expect(existsSync(jsonlPath)).toBe(true);
  });
});
