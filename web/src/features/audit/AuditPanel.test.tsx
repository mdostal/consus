import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
