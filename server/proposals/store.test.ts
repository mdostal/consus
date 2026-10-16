import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { proposeChange, reportProposalResult, redeliverProposal, listProposals } from "./store.js";
import type { HarnessTransport, HarnessResult } from "../harness/transport.js";

function insertItem(db: Database.Database, id: string) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "doc_ref", "Test item", "open", now, now);
}

function fakeTransport(result: HarnessResult): HarnessTransport & { calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    async invoke<T>(method: string, params?: unknown) {
      calls.push({ method, params });
      return result as HarnessResult<T>;
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

  it("records a pending proposal and dispatches it via the harness transport", async () => {
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

  it("dispatches a doc-review proposal (s4, consus-phase27-feature-doc-review-ui) through the harness transport exactly like a diagram's", async () => {
    // Mirrors web/src/features/docs/FeatureDetailView.tsx's real Approve
    // payload: itemId is a docItemIdFor(repo, path)-shaped id, targetType
    // is "doc", diff/description are the fixed approve marker text — never
    // a special-cased dispatch path, per this file's own "no content-type
    // branching" test just below.
    const transport = fakeTransport({ ok: true, result: { acknowledged: true } });
    insertItem(db, "doc:consus:.pHive/epics/sample-epic/docs/prd.md");

    const result = await proposeChange(db, transport, {
      itemId: "doc:consus:.pHive/epics/sample-epic/docs/prd.md",
      targetType: "doc",
      diff: "(no changes — approved as-is)",
      description: "Approved",
      requestedBy: "Mathew",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(result.proposalId) as Record<
      string,
      unknown
    >;
    expect(row.status).toBe("pending");
    expect(row.target_type).toBe("doc");

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].method).toBe("proposeChange");
    expect(transport.calls[0].params).toMatchObject({
      itemId: "doc:consus:.pHive/epics/sample-epic/docs/prd.md",
      targetType: "doc",
      description: "Approved",
    });
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

  it("stores the harness_ticket_id from a successful Pantheon dispatch", async () => {
    const transport = fakeTransport({ ok: true, result: { ticket_id: "pant-ticket-abc", status: "pending" } });
    insertItem(db, "item-ticket");

    const result = await proposeChange(db, transport, {
      itemId: "item-ticket",
      targetType: "decision",
      diff: "diff content",
      description: "store ticket id",
      requestedBy: "mathew",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = db.prepare("SELECT harness_ticket_id FROM proposals WHERE id = ?").get(result.proposalId) as {
      harness_ticket_id: string | null;
    };
    expect(row.harness_ticket_id).toBe("pant-ticket-abc");
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

  it("stores the PR link with an applied result, and leaves it null when none is reported (consus#203)", async () => {
    const withPr = await fireProposal();
    const withoutPr = await fireProposal();

    await reportProposalResult(db, { proposalId: withPr, status: "applied", prUrl: "https://github.com/acme/repo/pull/7" });
    await reportProposalResult(db, { proposalId: withoutPr, status: "applied" });

    const prUrlOf = (id: string) => (db.prepare("SELECT pr_url FROM proposals WHERE id = ?").get(id) as { pr_url: string | null }).pr_url;
    expect(prUrlOf(withPr)).toBe("https://github.com/acme/repo/pull/7");
    expect(prUrlOf(withoutPr)).toBeNull();
  });

  it("a repeated applied result fills in a missing PR link but never replaces one (consus#203)", async () => {
    const proposalId = await fireProposal();
    await reportProposalResult(db, { proposalId, status: "applied" });

    const backfill = await reportProposalResult(db, { proposalId, status: "applied", prUrl: "https://github.com/acme/repo/pull/7" });
    const replace = await reportProposalResult(db, { proposalId, status: "applied", prUrl: "https://github.com/acme/repo/pull/8" });

    expect(backfill).toEqual({ ok: true, alreadyResolved: true });
    expect(replace).toEqual({ ok: true, alreadyResolved: true });
    const row = db.prepare("SELECT pr_url FROM proposals WHERE id = ?").get(proposalId) as { pr_url: string | null };
    expect(row.pr_url).toBe("https://github.com/acme/repo/pull/7");
    const auditRows = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE item_id = ?").get("item-1") as { n: number };
    expect(auditRows.n).toBe(1);
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

  it("treats a repeated applied result as a no-op: one audit_log row, resolved_at unchanged", async () => {
    const proposalId = await fireProposal();
    await reportProposalResult(db, { proposalId, status: "applied", appliedDiff: "+ added X (confirmed)" });
    const before = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);

    const again = await reportProposalResult(db, { proposalId, status: "applied", appliedDiff: "+ something else" });

    expect(again).toEqual({ ok: true, alreadyResolved: true });
    expect(db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId)).toEqual(before);
    const auditRows = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE item_id = ?").get("item-1") as {
      n: number;
    };
    expect(auditRows.n).toBe(1);
  });

  it("treats a repeated failed result as a no-op", async () => {
    const proposalId = await fireProposal();
    await reportProposalResult(db, { proposalId, status: "failed", reason: "first" });
    const before = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);

    const again = await reportProposalResult(db, { proposalId, status: "failed", reason: "second" });

    expect(again).toEqual({ ok: true, alreadyResolved: true });
    expect(db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId)).toEqual(before);
  });

  it.each([
    ["applied", "failed"],
    ["failed", "applied"],
  ] as const)("rejects %s -> %s as a conflict and leaves the row unchanged", async (first, second) => {
    const proposalId = await fireProposal();
    await reportProposalResult(db, { proposalId, status: first, reason: "r" });
    const before = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);
    const auditBefore = db.prepare("SELECT COUNT(*) AS n FROM audit_log").get();

    const result = await reportProposalResult(db, { proposalId, status: second, reason: "r2" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("conflict");
    expect(db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()).toEqual(auditBefore);
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

describe("redeliverProposal", () => {
  let db: Database.Database;
  const INPUT = { itemId: "item-1", targetType: "doc", diff: "+ x", description: "add x", requestedBy: "mathew" };

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    insertItem(db, "item-1");
  });

  function row(id: string) {
    return db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as Record<string, unknown>;
  }

  async function undelivered() {
    const down = fakeTransport({ ok: false, recoverable: true, code: "INTERNAL_ERROR", message: "HTTP 502" });
    const result = await proposeChange(db, down, INPUT);
    if (!result.ok) throw new Error(result.error);
    return result.proposalId;
  }

  it("a dispatch failure records delivery_error alongside failure_reason", async () => {
    const id = await undelivered();
    expect(row(id)).toMatchObject({ status: "failed", failure_reason: "INTERNAL_ERROR: HTTP 502", delivery_error: "INTERNAL_ERROR: HTTP 502" });
  });

  it("a successful dispatch leaves delivery_error null", async () => {
    const result = await proposeChange(db, fakeTransport({ ok: true, result: null }), INPUT);
    if (!result.ok) throw new Error(result.error);
    expect(row(result.proposalId)).toMatchObject({ status: "pending", delivery_error: null });
  });

  it("redelivers the original payload once and puts the proposal back to pending", async () => {
    const id = await undelivered();
    const up = fakeTransport({ ok: true, result: { ticket_id: "T-1" } });

    expect(await redeliverProposal(db, up, id)).toEqual({ ok: true });

    expect(up.calls).toEqual([
      {
        method: "proposeChange",
        params: { proposalId: id, itemId: "item-1", targetType: "doc", diff: "+ x", description: "add x", sourceRepo: null },
      },
    ]);
    expect(row(id)).toMatchObject({
      status: "pending",
      resolved_at: null,
      failure_reason: null,
      delivery_error: null,
      harness_ticket_id: "T-1",
    });
  });

  it("a redelivery that fails again records the new delivery error", async () => {
    const id = await undelivered();
    const stillDown = fakeTransport({ ok: false, recoverable: true, code: "TIMEOUT" });
    expect(await redeliverProposal(db, stillDown, id)).toEqual({ ok: true });
    expect(row(id)).toMatchObject({ status: "failed", delivery_error: "TIMEOUT", failure_reason: "TIMEOUT" });
  });

  it("refuses a harness-reported failure (not a delivery failure) with conflict and does not dispatch", async () => {
    const result = await proposeChange(db, fakeTransport({ ok: true, result: null }), INPUT);
    if (!result.ok) throw new Error(result.error);
    await reportProposalResult(db, { proposalId: result.proposalId, status: "failed", reason: "merge conflict" });

    const t = fakeTransport({ ok: true, result: null });
    expect(await redeliverProposal(db, t, result.proposalId)).toMatchObject({ ok: false, code: "conflict" });
    expect(t.calls).toHaveLength(0);
    expect(row(result.proposalId)).toMatchObject({ status: "failed", failure_reason: "merge conflict" });
  });

  it("refuses a pending proposal with conflict", async () => {
    const result = await proposeChange(db, fakeTransport({ ok: true, result: null }), INPUT);
    if (!result.ok) throw new Error(result.error);
    expect(await redeliverProposal(db, fakeTransport({ ok: true, result: null }), result.proposalId)).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("only one of two concurrent retries dispatches", async () => {
    const id = await undelivered();
    const t = fakeTransport({ ok: true, result: null });
    const results = await Promise.all([redeliverProposal(db, t, id), redeliverProposal(db, t, id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(t.calls).toHaveLength(1);
  });

  it("returns not_found for an unknown proposal", async () => {
    expect(await redeliverProposal(db, fakeTransport({ ok: true, result: null }), "nope")).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});
