import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KBBrowser } from "./KBBrowser";

const ITEM = {
  id: "item-1",
  title: "Adopt React Flow for the DAG viewer",
  status: "open",
  decisionPayload: { contractVersion: "decision-request/v1" as const, answerShape: "approve" as const, question: "Adopt React Flow for the DAG viewer" },
};

describe("KBBrowser", () => {
  it("renders the item via the shared DecisionCard and calls onDecide with the answer", () => {
    const onDecide = vi.fn();
    render(<KBBrowser item={ITEM} versions={[]} auditLog={[]} onDecide={onDecide} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(onDecide).toHaveBeenCalledWith("item-1", "approve");
  });

  it("shows version history, not just the current state", () => {
    render(
      <KBBrowser
        item={ITEM}
        versions={[
          { id: 1, content: "v1", author: "mathew", created_at: "2026-07-25T00:00:00Z" },
          { id: 2, content: "v2", author: "mathew", created_at: "2026-07-25T01:00:00Z" },
        ]}
        auditLog={[]}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
  });

  it("shows the audit trail (actor, field, old->new) for this item", () => {
    render(
      <KBBrowser
        item={ITEM}
        versions={[]}
        auditLog={[
          { id: 1, item_id: "item-1", actor: "mathew", field: "status", old_value: "open", new_value: "approved", timestamp: "2026-07-25T00:00:00Z" },
        ]}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByText(/mathew/)).toBeInTheDocument();
    expect(screen.getByText(/open.*approved/)).toBeInTheDocument();
  });
});
