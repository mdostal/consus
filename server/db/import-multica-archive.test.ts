import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "./migrate.js";
import { importMulticaArchive } from "./import-multica-archive.js";

function writeJsonl(path: string, rows: unknown[]) {
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const AUDIT_ROWS = [
  {
    ts: "2026-07-20T22:41:00.593Z",
    actor: "you",
    itemId: "item-a",
    identifier: "DOS-741",
    action: "select-option",
    statusFrom: "in_review",
    statusTo: "todo",
    rationale: "Approve and merge",
    version: 1,
  },
  {
    ts: "2026-07-21T10:00:00.000Z",
    actor: "you",
    itemId: "item-a",
    identifier: "DOS-741",
    action: "select-option",
    statusFrom: "todo",
    statusTo: "done",
    rationale: "Shipped",
    version: 2,
  },
  {
    ts: "2026-07-22T00:00:00.000Z",
    actor: "you",
    itemId: "item-b",
    identifier: "DOS-742",
    action: "select-option",
    statusFrom: "in_review",
    statusTo: "rejected",
    rationale: "Not now",
    version: 1,
  },
];

const KB_ROWS = [
  {
    ts: "2026-07-21T01:47:46.194Z",
    kind: "approved-decision",
    identifier: "DOS-271",
    issueId: "issue-1",
    action: "approve",
    decision: null,
    rationale: "greenlight the FM backup scope",
    document: null,
    items: ["greenlight the FM backup scope"],
    status: "fired-off",
  },
  {
    ts: "2026-07-22T02:00:00.000Z",
    kind: "approved-decision",
    identifier: "DOS-272",
    issueId: "issue-2",
    action: "approve",
    decision: "yes",
    rationale: "second entry",
    document: null,
    items: [],
    status: "fired-off",
  },
];

describe("importMulticaArchive", () => {
  let db: Database.Database;
  let dir: string;
  let auditPath: string;
  let kbPath: string;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    dir = mkdtempSync(join(tmpdir(), "consus-archive-import-"));
    auditPath = join(dir, "delphi-audit.jsonl");
    kbPath = join(dir, "delphi-knowledgebase.jsonl");
    writeJsonl(auditPath, AUDIT_ROWS);
    writeJsonl(kbPath, KB_ROWS);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("imports every audit entry as an audit_log row, one per source line", () => {
    const result = importMulticaArchive(db, { auditPath, kbPath });

    expect(result.auditRowsImported).toBe(3);
    const count = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor = 'you'").get() as { n: number };
    expect(count.n).toBe(3);
  });

  it("synthesizes one item row per unique itemId, using the latest known status", () => {
    importMulticaArchive(db, { auditPath, kbPath });

    const itemA = db.prepare("SELECT * FROM items WHERE id = ?").get("delphi-archive:item-a") as
      | Record<string, unknown>
      | undefined;
    expect(itemA?.status).toBe("done"); // latest statusTo for item-a
    expect(itemA?.title).toBe("DOS-741");

    const count = db.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'delphi-archive:%'").get() as {
      n: number;
    };
    expect(count.n).toBe(2); // item-a, item-b
  });

  it("imports every KB entry as a kb_entries + kb_versions row", () => {
    const result = importMulticaArchive(db, { auditPath, kbPath });

    expect(result.kbRowsImported).toBe(2);
    const entries = db.prepare("SELECT COUNT(*) AS n FROM kb_entries WHERE id LIKE 'delphi-archive:%'").get() as {
      n: number;
    };
    expect(entries.n).toBe(2);
    const versions = db.prepare("SELECT COUNT(*) AS n FROM kb_versions").get() as { n: number };
    expect(versions.n).toBe(2);
  });

  it("is idempotent — re-running against the same archive does not duplicate rows", () => {
    importMulticaArchive(db, { auditPath, kbPath });
    const second = importMulticaArchive(db, { auditPath, kbPath });

    expect(second.auditRowsImported).toBe(0);
    expect(second.kbRowsImported).toBe(0);

    const auditCount = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor = 'you'").get() as { n: number };
    expect(auditCount.n).toBe(3);
    const kbCount = db.prepare("SELECT COUNT(*) AS n FROM kb_entries WHERE id LIKE 'delphi-archive:%'").get() as {
      n: number;
    };
    expect(kbCount.n).toBe(2);
  });

  it("works against a different archive path with no code changes — the generic-importer requirement", () => {
    const otherDir = mkdtempSync(join(tmpdir(), "consus-archive-other-"));
    const otherAudit = join(otherDir, "other-audit.jsonl");
    const otherKb = join(otherDir, "other-kb.jsonl");
    writeJsonl(otherAudit, [AUDIT_ROWS[0]]);
    writeJsonl(otherKb, [KB_ROWS[0]]);

    const result = importMulticaArchive(db, { auditPath: otherAudit, kbPath: otherKb });

    expect(result.auditRowsImported).toBe(1);
    expect(result.kbRowsImported).toBe(1);
    rmSync(otherDir, { recursive: true, force: true });
  });
});
