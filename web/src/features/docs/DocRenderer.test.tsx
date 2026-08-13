import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocRenderer } from "./DocRenderer";

describe("DocRenderer", () => {
  it("renders markdown as formatted content, not raw markup", () => {
    render(<DocRenderer format="md" content={"# Heading\n\nSome **bold** text."} />);

    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(screen.queryByText("# Heading")).not.toBeInTheDocument();
  });

  it("renders html content inside an isolated container, not raw markup", () => {
    render(<DocRenderer format="html" content={"<p>hello <strong>world</strong></p>"} />);

    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("does not show a propose-a-change action when onProposeChange is not supplied", () => {
    render(<DocRenderer format="md" content="hello" />);
    expect(screen.queryByRole("button", { name: /propose a change/i })).not.toBeInTheDocument();
  });
});

describe("DocRenderer — propose a change (s5)", () => {
  it("reveals a diff + description form when 'propose a change' is clicked", () => {
    render(<DocRenderer format="md" content="hello" onProposeChange={vi.fn()} />);

    expect(screen.queryByPlaceholderText(/added x/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));
    expect(screen.getByPlaceholderText(/added x/i)).toBeInTheDocument();
  });

  it("fires the composed diff + description via onProposeChange, then closes the form", () => {
    const onProposeChange = vi.fn();
    render(<DocRenderer format="md" content="hello" onProposeChange={onProposeChange} />);

    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));
    fireEvent.change(screen.getByPlaceholderText(/removed load balancers/i), {
      target: { value: "clarify the rollback section" },
    });
    fireEvent.change(screen.getByPlaceholderText(/added x/i), { target: { value: "+ add a rollback note" } });
    fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

    expect(onProposeChange).toHaveBeenCalledWith({
      diff: "+ add a rollback note",
      description: "clarify the rollback section",
    });
    expect(screen.queryByPlaceholderText(/added x/i)).not.toBeInTheDocument();
  });

  it("never writes to the doc content directly — content prop is unchanged after firing", () => {
    render(<DocRenderer format="md" content="# Original content" onProposeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));
    fireEvent.change(screen.getByPlaceholderText(/removed load balancers/i), { target: { value: "d" } });
    fireEvent.change(screen.getByPlaceholderText(/added x/i), { target: { value: "diff" } });
    fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

    expect(screen.getByRole("heading", { name: "Original content" })).toBeInTheDocument();
  });

  it("shows a pending indicator while a proposal is in flight", () => {
    render(<DocRenderer format="md" content="hello" onProposeChange={vi.fn()} pendingProposal />);
    expect(screen.getByText(/change proposed/i)).toBeInTheDocument();
  });

  it("shows the failure reason when a proposal resolves to failed", () => {
    render(
      <DocRenderer
        format="md"
        content="hello"
        onProposeChange={vi.fn()}
        proposalFailureReason="INTERNAL_ERROR: failed to spawn Minerva"
      />,
    );
    expect(screen.getByText(/failed to spawn minerva/i)).toBeInTheDocument();
  });
});
