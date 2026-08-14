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
    expect(screen.queryByRole("button", { name: /fire to harness/i })).not.toBeInTheDocument();
  });
});

describe("DocRenderer — propose a change (s5/p8-02)", () => {
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

describe("DocRenderer — in-place edit/view toggle (p8-01)", () => {
  it("does not show an Edit button before content has loaded", () => {
    render(<DocRenderer format="md" content="" />);
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("shows an Edit button once content has loaded, in view mode", () => {
    render(<DocRenderer format="md" content="# Original content" />);
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("clicking Edit replaces the rendered content with a textarea pre-filled with the current content", () => {
    render(<DocRenderer format="md" content="# Original content" />);

    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(screen.queryByTestId("doc-html")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-edit-textarea")).toHaveValue("# Original content");
  });

  it("hides the Edit button while in edit mode and shows Cancel instead", () => {
    render(<DocRenderer format="md" content="# Original content" />);

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("clicking Cancel reverts modified textarea content and returns to view mode with no change submitted", () => {
    const onProposeChange = vi.fn();
    render(<DocRenderer format="md" content="# Original content" onProposeChange={onProposeChange} />);

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByTestId("doc-edit-textarea"), { target: { value: "# Edited content" } });
    expect(screen.getByTestId("doc-edit-textarea")).toHaveValue("# Edited content");

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByTestId("doc-edit-textarea")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Original content" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    expect(onProposeChange).not.toHaveBeenCalled();
  });

  it("resets to view mode with fresh content when a different doc is opened", () => {
    const { rerender } = render(<DocRenderer format="md" content="# Doc one" />);

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByTestId("doc-edit-textarea"), { target: { value: "unsaved edits to doc one" } });
    expect(screen.getByTestId("doc-edit-textarea")).toHaveValue("unsaved edits to doc one");

    rerender(<DocRenderer format="md" content="# Doc two" />);

    expect(screen.queryByTestId("doc-edit-textarea")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Doc two" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByTestId("doc-edit-textarea")).toHaveValue("# Doc two");
  });
});

describe("DocRenderer — auto-diff fire action (p8-02)", () => {
  it("does not render the old manual raw-diff textarea anywhere in the markup", () => {
    render(<DocRenderer format="md" content="# Original content" onProposeChange={vi.fn()} />);

    expect(screen.queryByPlaceholderText(/added x/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^diff$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(screen.queryByPlaceholderText(/added x/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^diff$/i)).not.toBeInTheDocument();
  });

  it("disables Fire to harness when the edited draft is unchanged from the original content", () => {
    render(<DocRenderer format="md" content="# Original content" onProposeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByPlaceholderText(/removed load balancers/i), {
      target: { value: "a real description" },
    });

    expect(screen.getByRole("button", { name: /fire to harness/i })).toBeDisabled();
  });

  it("enables Fire to harness once the draft differs from the original content and a description is supplied", () => {
    render(<DocRenderer format="md" content="# Original content" onProposeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("button", { name: /fire to harness/i })).toBeDisabled();

    fireEvent.change(screen.getByTestId("doc-edit-textarea"), {
      target: { value: "# Original content\nExtra line added" },
    });
    expect(screen.getByRole("button", { name: /fire to harness/i })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/removed load balancers/i), {
      target: { value: "add a note" },
    });
    expect(screen.getByRole("button", { name: /fire to harness/i })).not.toBeDisabled();
  });

  it("computes a diff from the actual edit and fires it via onProposeChange, with no manual diff entry", () => {
    const onProposeChange = vi.fn();
    render(<DocRenderer format="md" content="# Original content" onProposeChange={onProposeChange} />);

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByTestId("doc-edit-textarea"), {
      target: { value: "# Original content\nExtra line added" },
    });
    fireEvent.change(screen.getByPlaceholderText(/removed load balancers/i), {
      target: { value: "add a note about rollback" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

    expect(onProposeChange).toHaveBeenCalledWith({
      diff: "  # Original content\n+ Extra line added",
      description: "add a note about rollback",
    });
  });

  it("returns to view mode after firing, reflecting a pending proposal", () => {
    const onProposeChange = vi.fn();
    render(<DocRenderer format="md" content="# Original content" onProposeChange={onProposeChange} />);

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByTestId("doc-edit-textarea"), {
      target: { value: "# Edited content" },
    });
    fireEvent.change(screen.getByPlaceholderText(/removed load balancers/i), {
      target: { value: "rewrite the heading" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

    expect(screen.queryByTestId("doc-edit-textarea")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    // content prop is never mutated by Consus itself — still renders the
    // original heading until the caller re-fetches after the harness acts.
    expect(screen.getByRole("heading", { name: "Original content" })).toBeInTheDocument();
  });

  it("still renders the pending/failed pills above the doc when a proposal is in flight or failed, for the new flow", () => {
    const { rerender } = render(
      <DocRenderer format="md" content="# Original content" onProposeChange={vi.fn()} pendingProposal />,
    );
    expect(screen.getByText(/change proposed/i)).toBeInTheDocument();

    rerender(
      <DocRenderer
        format="md"
        content="# Original content"
        onProposeChange={vi.fn()}
        proposalFailureReason="INTERNAL_ERROR: failed to spawn Minerva"
      />,
    );
    expect(screen.getByText(/failed to spawn minerva/i)).toBeInTheDocument();
  });
});
