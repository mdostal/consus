import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditPanel, type AuditTrailEntry } from "./AuditPanel";

describe("AuditPanel", () => {
  it("shows an empty state, not a broken/blank panel, when there's no history", () => {
    render(<AuditPanel entries={[]} />);
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });

  it("renders an audit_log entry with actor/field/old->new", () => {
    const entries: AuditTrailEntry[] = [
      {
        kind: "audit",
        id: 1,
        actor: "mathew",
        field: "status",
        old_value: "open",
        new_value: "approved",
        timestamp: "2026-08-13T00:00:00Z",
      },
    ];
    render(<AuditPanel entries={entries} />);

    expect(screen.getByText(/mathew changed status: open → approved/)).toBeInTheDocument();
  });

  it("renders a proposal entry, clearly distinguished from an audit_log entry", () => {
    const entries: AuditTrailEntry[] = [
      {
        kind: "proposal",
        id: "p-1",
        target_type: "diagram",
        description: "removed the load balancer node",
        status: "applied",
        requested_by: "mathew",
        timestamp: "2026-08-13T00:00:00Z",
        applied_diff: "+ direct traffic",
        failure_reason: null,
      },
    ];
    render(<AuditPanel entries={entries} />);

    expect(screen.getByText(/proposal · applied/i)).toBeInTheDocument();
    expect(screen.getByText(/removed the load balancer node/)).toBeInTheDocument();
  });

  it("shows the failure reason on a failed proposal", () => {
    const entries: AuditTrailEntry[] = [
      {
        kind: "proposal",
        id: "p-2",
        target_type: "doc",
        description: "clarify rollback",
        status: "failed",
        requested_by: "mathew",
        timestamp: "2026-08-13T00:00:00Z",
        applied_diff: null,
        failure_reason: "harness unreachable",
      },
    ];
    render(<AuditPanel entries={entries} />);

    expect(screen.getByText(/harness unreachable/)).toBeInTheDocument();
  });

  it("renders identically regardless of the mix of audit and proposal entries — same component, no branching by caller", () => {
    const entries: AuditTrailEntry[] = [
      {
        kind: "audit",
        id: 1,
        actor: "mathew",
        field: "status",
        old_value: "open",
        new_value: "approved",
        timestamp: "2026-08-13T00:00:00Z",
      },
      {
        kind: "proposal",
        id: "p-1",
        target_type: "decision",
        description: "iterate on the recommendation",
        status: "pending",
        requested_by: "mathew",
        timestamp: "2026-08-13T00:01:00Z",
        applied_diff: null,
        failure_reason: null,
      },
    ];
    render(<AuditPanel entries={entries} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  describe("Retry delivery", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const undelivered: AuditTrailEntry = {
      kind: "proposal",
      id: "p-3",
      target_type: "diagram",
      description: "add node X",
      status: "failed",
      requested_by: "mathew",
      timestamp: "2026-10-10T00:00:00Z",
      applied_diff: null,
      failure_reason: "INTERNAL_ERROR: HTTP 503",
      delivery_error: "INTERNAL_ERROR: HTTP 503",
    };

    function jsonRes(status: number, body: unknown) {
      return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    }

    it("is offered only on a delivery failure, not on a harness-reported failure", () => {
      render(<AuditPanel entries={[undelivered, { ...undelivered, id: "p-4", delivery_error: null }]} />);
      expect(screen.getAllByRole("button", { name: /retry delivery/i })).toHaveLength(1);
    });

    it("redelivers through POST /api/proposals/:id/redeliver and shows the new status", async () => {
      const fetchMock = vi.fn(() => jsonRes(200, { status: "pending", failure_reason: null, delivery_error: null }));
      vi.stubGlobal("fetch", fetchMock);
      render(<AuditPanel entries={[undelivered]} />);

      await userEvent.setup().click(screen.getByRole("button", { name: /retry delivery/i }));

      expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p-3/redeliver", { method: "POST" });
      expect(await screen.findByText(/proposal · pending/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /retry delivery/i })).not.toBeInTheDocument();
    });

    it("shows the error when the retry request itself is refused", async () => {
      vi.stubGlobal("fetch", vi.fn(() => jsonRes(409, { error: "no delivery failure to retry" })));
      render(<AuditPanel entries={[undelivered]} />);

      await userEvent.setup().click(screen.getByRole("button", { name: /retry delivery/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/no delivery failure to retry/);
      expect(screen.getByText(/proposal · failed/i)).toBeInTheDocument();
    });
  });
});
