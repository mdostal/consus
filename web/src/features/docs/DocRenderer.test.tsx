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
