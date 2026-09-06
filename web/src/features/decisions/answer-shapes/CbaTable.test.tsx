import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CbaTable } from "./CbaTable";
import type { CbaPayload } from "./types";

const PAYLOAD: CbaPayload = {
  version: "dostal:cba/v1",
  title: "Buy vs build the reporting pipeline",
  context: "Compare the two paths before committing.",
  options: [
    { option: "Buy", cost: "$50k/yr", benefit: "Fast to ship", notes: "Vendor lock-in risk" },
    { option: "Build", cost: "2 eng-months", benefit: "Full control" },
  ],
};

describe("CbaTable", () => {
  it("renders one row per option with cost/benefit/notes columns", () => {
    render(<CbaTable payload={PAYLOAD} onVerdict={vi.fn()} />);

    const table = screen.getByRole("table", { name: /cost\/benefit comparison/i });
    expect(table).toBeInTheDocument();

    expect(screen.getByText("Buy")).toBeInTheDocument();
    expect(screen.getByText("$50k/yr")).toBeInTheDocument();
    expect(screen.getByText("Fast to ship")).toBeInTheDocument();
    expect(screen.getByText("Vendor lock-in risk")).toBeInTheDocument();

    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("2 eng-months")).toBeInTheDocument();
    expect(screen.getByText("Full control")).toBeInTheDocument();
  });

  it("renders column headers", () => {
    render(<CbaTable payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByRole("columnheader", { name: "Option" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Cost" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Benefit" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Notes" })).toBeInTheDocument();
  });

  it("does not render any scoring, weighting, or recommendation UI — table only", () => {
    render(<CbaTable payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.queryByText(/recommend/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("recommended-badge")).not.toBeInTheDocument();
  });

  it("accepting fires an 'accepted' verdict", () => {
    const onVerdict = vi.fn();
    render(<CbaTable payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "accepted" });
  });

  it("rejecting requires commentary and fires a 'rejected_iteration_requested' verdict", () => {
    const onVerdict = vi.fn();
    render(<CbaTable payload={PAYLOAD} onVerdict={onVerdict} />);

    const rejectButton = screen.getByRole("button", { name: /reject/i });
    expect(rejectButton).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: /commentary/i }), { target: { value: "need more data" } });
    fireEvent.click(rejectButton);

    expect(onVerdict).toHaveBeenCalledWith({ kind: "rejected_iteration_requested", commentary: "need more data" });
  });
});
