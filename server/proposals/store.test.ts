import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { proposeChange, reportProposalResult, listProposals } from "./store.js";
import type { MinervaTransport, MinervaResult } from "../adapters/minerva/transport.js";

function insertItem(db: Database.Database, id: string) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", "Test item", "open", now, now);
}

function fakeTransport(result: MinervaResult): MinervaTransport & { calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    async invoke<T>(method: string, params?: unknown) {
      calls.push({ method, params });
      return result as MinervaResult<T>;
    },
  };
}

describe("proposeChange", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");
  });

  it("records a pending proposal and dispatches it via the Minerva transport", async () => {
    const transport = fakeTransport({ ok: true, result: { acknowledged: true } });

    const result = await proposeChange(db, transport, {
      itemId: "item-1",
      targetType: "diagram",
      diff: "+ added node X\n- removed node Y",
      description: "removed load balancers for direct traffic",
      requestedBy: "mathew",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(result.proposalId) as Record<
      string,
      unknown
    >;
    expect(row.status).toBe("pending");
    expect(row.item_id).toBe("item-1");
    expect(row.target_type).toBe("diagram");

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].method).toBe("proposeChange");
  });

  it("works identically for a decision, a diagram, or a doc — no content-type branching in the dispatch path", async () => {
    const transport = fakeTransport({ ok: true, result: {} });

    for (const targetType of ["decision", "diagram", "doc"]) {
      const result = await proposeChange(db, transport, {
        itemId: "item-1",
        targetType,
        diff: "d",
        description: "desc",
        requestedBy: "mathew",
      });
      expect(result.ok).toBe(true);
    }

    expect(transport.calls).toHaveLength(3);
    expect(transport.calls.every((c) => c.method === "proposeChange")).toBe(true);
  });

  it("fails clearly when the target item does not exist, rather than inserting an orphaned proposal", async () => {
    const transport = fakeTransport({ ok: true, result: {} });

    const result = await proposeChange(db, transport, {
      itemId: "does-not-exist",
      targetType: "doc",
      diff: "d",
      description: "desc",
      requestedBy: "mathew",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/i);

    const count = db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("marks the proposal failed immediately when dispatch itself fails — never left stuck pending", async () => {
    const transport = fakeTransport({ ok: false, recoverable: false, code: "TIMEOUT" });

    const result = await proposeChange(db, transport, {
      itemId: "item-1",
      targetType: "doc",
      diff: "d",
      description: "desc",
      requestedBy: "mathew",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = db.prepare("SELECT status, failure_reason FROM proposals WHERE id = ?").get(result.proposalId) as {
      status: string;
      failure_reason: string | null;
    };
    expect(row.status).toBe("failed");
    expect(row.failure_reason).toContain("TIMEOUT");
  });
});

describe("reportProposalResult", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");
  });

  async function fireProposal() {
    const transport = fakeTransport({ ok: true, result: {} });
    const result = await proposeChange(db, transport, {
      itemId: "item-1",
      targetType: "diagram",
      diff: "+ added X",
      description: "add X",
      requestedBy: "mathew",
    });
    if (!result.ok) throw new Error("setup failed");
    return result.proposalId;
  }

  it("transitions a pending proposal to applied and writes an audit_log entry", async () => {
    const proposalId = await fireProposal();

    const result = await reportProposalResult(db, {
      proposalId,
      status: "applied",
      appliedDiff: "+ added X (confirmed)",
    });

    expect(result.ok).toBe(true);

    const row = db.prepare("SELECT status, applied_diff, resolved_at FROM proposals WHERE id = ?").get(
      proposalId,
    ) as { status: string; applied_diff: string | null; resolved_at: string | null };
    expect(row.status).toBe("applied");
    expect(row.applied_diff).toBe("+ added X (confirmed)");
    expect(row.resolved_at).not.toBeNull();

    const auditRows = db.prepare("SELECT * FROM audit_log WHERE item_id = ?").all("item-1") as Array<
      Record<string, unknown>
    >;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].new_value).toBe("+ added X (confirmed)");
  });

  it("transitions a pending proposal to failed with a reason, and writes no audit_log entry", async () => {
    const proposalId = await fireProposal();

    const result = await reportProposalResult(db, {
      proposalId,
      status: "failed",
      reason: "target file locked by another process",
    });

    expect(result.ok).toBe(true);

    const row = db.prepare("SELECT status, failure_reason FROM proposals WHERE id = ?").get(proposalId) as {
      status: string;
      failure_reason: string | null;
    };
    expect(row.status).toBe("failed");
    expect(row.failure_reason).toBe("target file locked by another process");

    const auditRows = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE item_id = ?").get("item-1") as {
      n: number;
    };
    expect(auditRows.n).toBe(0);
  });

  it("returns a clear error for an unknown proposal id instead of throwing", async () => {
    const result = await reportProposalResult(db, { proposalId: "does-not-exist", status: "applied" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/i);
  });
});

describe("listProposals", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");
    insertItem(db, "item-2");
  });

  it("lists every proposal for an item, most recent first", async () => {
    const transport = fakeTransport({ ok: true, result: {} });
    await proposeChange(db, transport, {
      itemId: "item-1",
      targetType: "doc",
      diff: "d1",
      description: "first",
      requestedBy: "mathew",
    });
    await proposeChange(db, transport, {
      itemId: "item-1",
      targetType: "doc",
      diff: "d2",
      description: "second",
      requestedBy: "mathew",
    });
    await proposeChange(db, transport, {
      itemId: "item-2",
      targetType: "doc",
      diff: "d3",
      description: "other item",
      requestedBy: "mathew",
    });

    const rows = listProposals(db, "item-1");

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.description)).toEqual(["second", "first"]);
  });
});
