import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionCard } from "./DecisionCard";

const PAYLOAD = {
  version: "dostal:decision-request/v1" as const,
  title: "Ship v1?",
  context: "ctx",
  options: [
    { id: "A", title: "Yes", tradeoffs: "" },
    { id: "B", title: "No", tradeoffs: "" },
  ],
  recommended: "A",
};

describe("DecisionCard", () => {
  it("renders a question, a recommendation, and an answer slot (go/no-go pattern)", () => {
    render(
      <DecisionCard
        question="Ship v1 with the flex-scope KB backlog cut?"
        recommendation="Recommend: yes, ship without it."
        payload={PAYLOAD}
        onVerdict={vi.fn()}
      />,
    );

    expect(screen.getByText(/Ship v1 with the flex-scope KB backlog cut\?/)).toBeInTheDocument();
    expect(screen.getByText(/Recommend: yes, ship without it\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("renders a status/severity pill when provided, not buried in prose", () => {
    render(<DecisionCard question="q" payload={PAYLOAD} status="P0" onVerdict={vi.fn()} />);

    expect(screen.getByTestId("status-pill")).toHaveTextContent("P0");
  });

  it("renders a long source doc as a collapsible block, not always-expanded", () => {
    render(
      <DecisionCard
        question="q"
        payload={PAYLOAD}
        sourceDoc="Very long source content that should be collapsed by default."
        onVerdict={vi.fn()}
      />,
    );

    const details = screen.getByTestId("source-doc");
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(details).not.toHaveAttribute("open");
  });

  it("resolves options A-Z with tradeoffs and a recommended marker — never a lone 'Approve' button", () => {
    render(
      <DecisionCard
        question="Which DAG engine?"
        payload={{
          version: "dostal:decision-request/v1",
          title: "Which DAG engine?",
          context: "ctx",
          options: [
            { id: "A", title: "React Flow", tradeoffs: "+ own the JSON" },
            { id: "B", title: "tldraw", tradeoffs: "+ best canvas" },
          ],
          recommended: "A",
        }}
        onVerdict={vi.fn()}
      />,
    );

    expect(screen.getByText("React Flow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose tldraw/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("calls onVerdict when the operator accepts", () => {
    const onVerdict = vi.fn();
    render(<DecisionCard question="q" payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "accepted" });
  });

  it("does not show the fire-agent trigger or Versions view when their props are omitted", () => {
    render(<DecisionCard question="q" payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /fire agent to iterate/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Versions")).not.toBeInTheDocument();
  });

  it("shows the fire-agent trigger when onFireAgent is supplied (REQ-16)", () => {
    render(<DecisionCard question="q" payload={PAYLOAD} onVerdict={vi.fn()} onFireAgent={vi.fn()} />);

    expect(screen.getByRole("button", { name: /fire agent to iterate/i })).toBeInTheDocument();
  });

  it("shows a Versions section listing iterate-request history when versionsEntries is supplied", () => {
    render(
      <DecisionCard
        question="q"
        payload={PAYLOAD}
        onVerdict={vi.fn()}
        versionsEntries={[
          {
            log_id: "log-1",
            timestamp: "2026-08-13T00:00:00Z",
            actor: "mathew",
            prompt: "redo it",
            scope: null,
            agent: null,
            comment_id: "c-1",
            status_set: null,
            previous_status: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Versions")).toBeInTheDocument();
    expect(screen.getByText(/redo it/)).toBeInTheDocument();
  });
});
