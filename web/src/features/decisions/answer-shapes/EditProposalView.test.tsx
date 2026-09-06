import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditProposalView } from "./EditProposalView";
import type { EditProposalPayload } from "./types";

const PAYLOAD: EditProposalPayload = {
  version: "dostal:edit-proposal/v1",
  title: "Amend the weekly ops report",
  context: "Tighten the summary paragraph.",
  original: "line one\nline two\nline three",
  proposed: "line one\nline two, tightened\nline three",
};

describe("EditProposalView", () => {
  it("renders context and a diff line for every original/proposed line", () => {
    render(<EditProposalView payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByText("Tighten the summary paragraph.")).toBeInTheDocument();
    const diff = screen.getByTestId("edit-proposal-diff");
    expect(diff).toBeInTheDocument();
  });

  it("marks unchanged lines as context and changed lines as added/removed", () => {
    render(<EditProposalView payload={PAYLOAD} onVerdict={vi.fn()} />);

    const diff = screen.getByTestId("edit-proposal-diff");
    const kinds = Array.from(diff.querySelectorAll("[data-diff-kind]")).map((el) => el.getAttribute("data-diff-kind"));

    expect(kinds).toContain("context");
    expect(kinds).toContain("removed");
    expect(kinds).toContain("added");
    expect(screen.getByText("line one")).toBeInTheDocument();
    expect(screen.getByText("line two")).toBeInTheDocument();
    expect(screen.getByText("line two, tightened")).toBeInTheDocument();
  });

  it("accepting fires an 'accepted' verdict", () => {
    const onVerdict = vi.fn();
    render(<EditProposalView payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "accepted" });
  });

  it("rejecting requires commentary and fires a 'rejected_iteration_requested' verdict", () => {
    const onVerdict = vi.fn();
    render(<EditProposalView payload={PAYLOAD} onVerdict={onVerdict} />);

    const rejectButton = screen.getByRole("button", { name: /reject/i });
    expect(rejectButton).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: /commentary/i }), { target: { value: "try again" } });
    fireEvent.click(rejectButton);

    expect(onVerdict).toHaveBeenCalledWith({ kind: "rejected_iteration_requested", commentary: "try again" });
  });
});
