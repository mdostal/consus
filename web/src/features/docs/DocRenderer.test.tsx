import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DocRenderer } from "./DocRenderer";
import { computeLineDiff } from "./textDiff";

const THREE_SECTION_DOC =
  "## Section One\nline a\n## Section Two\nline b\n## Section Three\nline c";

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

describe("DocRenderer — in-place edit/view toggle, heading-less single-section doc (p8-01, p12-01 no-regression)", () => {
  // p12-01: a doc with no headings splits into exactly one section
  // (splitIntoSections falls back to [content]), so it must behave exactly
  // as DocRenderer did before this story — one Edit control, one textarea,
  // one Fire to harness. "# Original content" below is itself a single h1,
  // which also yields exactly one section, so these ported whole-doc tests
  // remain valid single-section coverage.

  it("does not show an Edit button before content has loaded", () => {
    render(<DocRenderer format="md" content="" onProposeChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("shows a single Edit button once content has loaded, in view mode", () => {
    render(<DocRenderer format="md" content="# Original content" onProposeChange={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(1);
  });

  it("clicking Edit replaces the rendered content with a textarea pre-filled with the current content", () => {
    render(<DocRenderer format="md" content="# Original content" onProposeChange={vi.fn()} />);

    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(screen.queryByTestId("doc-html")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-edit-textarea-0")).toHaveValue("# Original content");
  });

  it("hides the Edit button while in edit mode and shows Cancel instead", () => {
    render(<DocRenderer format="md" content="# Original content" onProposeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("clicking Cancel reverts modified textarea content and returns to view mode with no change submitted", () => {
    const onProposeChange = vi.fn();
    render(<DocRenderer format="md" content="# Original content" onProposeChange={onProposeChange} />);

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByTestId("doc-edit-textarea-0"), { target: { value: "# Edited content" } });
    expect(screen.getByTestId("doc-edit-textarea-0")).toHaveValue("# Edited content");

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByTestId("doc-edit-textarea-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Original content" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    expect(onProposeChange).not.toHaveBeenCalled();
  });

  it("resets to view mode with fresh content when a different doc is opened", () => {
    const onProposeChange = vi.fn();
    const { rerender } = render(
      <DocRenderer format="md" content="# Doc one" onProposeChange={onProposeChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByTestId("doc-edit-textarea-0"), {
      target: { value: "unsaved edits to doc one" },
    });
    expect(screen.getByTestId("doc-edit-textarea-0")).toHaveValue("unsaved edits to doc one");

    rerender(<DocRenderer format="md" content="# Doc two" onProposeChange={onProposeChange} />);

    expect(screen.queryByTestId("doc-edit-textarea-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Doc two" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByTestId("doc-edit-textarea-0")).toHaveValue("# Doc two");
  });
});

describe("DocRenderer — auto-diff fire action, single-section doc (p8-02)", () => {
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

    fireEvent.change(screen.getByTestId("doc-edit-textarea-0"), {
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
    fireEvent.change(screen.getByTestId("doc-edit-textarea-0"), {
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
    fireEvent.change(screen.getByTestId("doc-edit-textarea-0"), {
      target: { value: "# Edited content" },
    });
    fireEvent.change(screen.getByPlaceholderText(/removed load balancers/i), {
      target: { value: "rewrite the heading" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

    expect(screen.queryByTestId("doc-edit-textarea-0")).not.toBeInTheDocument();
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

describe("DocRenderer — sectional edit state (p12-01)", () => {
  it("shows one independent Edit control per section, with the rendered content otherwise unchanged", () => {
    render(<DocRenderer format="md" content={THREE_SECTION_DOC} onProposeChange={vi.fn()} />);

    // Three h2 sections -> three independent Edit controls, not one
    // whole-document Edit button.
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(3);

    // The rendered content is still the same single marked.parse output as
    // before this story — all three headings present in one doc-html block.
    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Section One" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Section Two" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Section Three" })).toBeInTheDocument();
  });

  it("shows no Edit controls on any section in read-only mode (no onProposeChange)", () => {
    render(<DocRenderer format="md" content={THREE_SECTION_DOC} />);

    expect(screen.queryAllByRole("button", { name: /^edit$/i })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /fire to harness/i })).toHaveLength(0);
    // Read-only docs still render their content normally.
    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Section Two" })).toBeInTheDocument();
  });

  it("firing one section's change leaves another section's in-progress draft completely untouched", () => {
    const onProposeChange = vi.fn();
    render(<DocRenderer format="md" content={THREE_SECTION_DOC} onProposeChange={onProposeChange} />);

    const sectionZero = screen.getByTestId("doc-section-0");
    const sectionOne = screen.getByTestId("doc-section-1");
    const sectionTwo = screen.getByTestId("doc-section-2");

    // Edit section 0 and fill in a description.
    fireEvent.click(within(sectionZero).getByRole("button", { name: /^edit$/i }));
    const editedSectionZero = "## Section One\nline a EDITED";
    fireEvent.change(screen.getByTestId("doc-edit-textarea-0"), { target: { value: editedSectionZero } });
    fireEvent.change(within(sectionZero).getByPlaceholderText(/removed load balancers/i), {
      target: { value: "edit section one" },
    });

    // Separately, edit section 2 with a different unsaved change.
    fireEvent.click(within(sectionTwo).getByRole("button", { name: /^edit$/i }));
    const editedSectionTwo = "## Section Three\nline c EDITED DIFFERENTLY";
    fireEvent.change(screen.getByTestId("doc-edit-textarea-2"), { target: { value: editedSectionTwo } });
    fireEvent.change(within(sectionTwo).getByPlaceholderText(/removed load balancers/i), {
      target: { value: "edit section three" },
    });

    // Section 1 was never touched — still shows its own Edit control.
    expect(within(sectionOne).getByRole("button", { name: /^edit$/i })).toBeInTheDocument();

    // Fire section 0 only.
    fireEvent.click(within(sectionZero).getByRole("button", { name: /fire to harness/i }));

    expect(onProposeChange).toHaveBeenCalledTimes(1);
    expect(onProposeChange).toHaveBeenCalledWith({
      diff: computeLineDiff("## Section One\nline a\n", editedSectionZero),
      description: "edit section one",
    });

    // Section 0 returns to view mode.
    expect(screen.queryByTestId("doc-edit-textarea-0")).not.toBeInTheDocument();
    expect(within(sectionZero).getByRole("button", { name: /^edit$/i })).toBeInTheDocument();

    // Section 2's in-progress edit is completely untouched: still present,
    // still in edit mode, not submitted, not discarded.
    expect(screen.getByTestId("doc-edit-textarea-2")).toHaveValue(editedSectionTwo);
    expect(within(sectionTwo).getByPlaceholderText(/removed load balancers/i)).toHaveValue("edit section three");

    // Section 1 remains untouched throughout.
    expect(within(sectionOne).getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("canceling one section's edit reverts only that section, leaving the others unaffected", () => {
    render(<DocRenderer format="md" content={THREE_SECTION_DOC} onProposeChange={vi.fn()} />);

    const sectionZero = screen.getByTestId("doc-section-0");
    const sectionOne = screen.getByTestId("doc-section-1");
    const sectionTwo = screen.getByTestId("doc-section-2");

    // Section 0 has an unsaved edit.
    fireEvent.click(within(sectionZero).getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByTestId("doc-edit-textarea-0"), {
      target: { value: "## Section One\nunsaved change" },
    });

    // Section 1 is also mid-edit with a different unsaved draft.
    fireEvent.click(within(sectionOne).getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByTestId("doc-edit-textarea-1"), {
      target: { value: "## Section Two\na different unsaved change" },
    });

    // Section 2 is untouched, still in view mode.
    expect(within(sectionTwo).getByRole("button", { name: /^edit$/i })).toBeInTheDocument();

    // Cancel section 1 only.
    fireEvent.click(within(sectionOne).getByRole("button", { name: /^cancel$/i }));

    // Only section 1 reverts to view mode with its draft discarded.
    expect(screen.queryByTestId("doc-edit-textarea-1")).not.toBeInTheDocument();
    expect(within(sectionOne).getByRole("button", { name: /^edit$/i })).toBeInTheDocument();

    // Section 0's unsaved edit survives untouched.
    expect(screen.getByTestId("doc-edit-textarea-0")).toHaveValue("## Section One\nunsaved change");

    // Section 2 is unaffected.
    expect(within(sectionTwo).getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("resets every section's edit state when the doc's content prop changes (navigation to a different doc)", () => {
    const onProposeChange = vi.fn();
    const { rerender } = render(
      <DocRenderer format="md" content={THREE_SECTION_DOC} onProposeChange={onProposeChange} />,
    );

    const sectionZero = screen.getByTestId("doc-section-0");
    fireEvent.click(within(sectionZero).getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByTestId("doc-edit-textarea-0"), {
      target: { value: "unsaved edit that should not survive navigation" },
    });
    expect(screen.getByTestId("doc-edit-textarea-0")).toBeInTheDocument();

    const NEW_DOC = "## New A\nfirst\n## New B\nsecond";
    rerender(<DocRenderer format="md" content={NEW_DOC} onProposeChange={onProposeChange} />);

    // No section retains an in-progress edit across the navigation.
    expect(screen.queryByTestId(/doc-edit-textarea-/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "New A" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New B" })).toBeInTheDocument();

    // Editing the new doc's first section starts from a fresh draft, not a
    // leftover from the previous doc.
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
    expect(screen.getByTestId("doc-edit-textarea-0")).toHaveValue("## New A\nfirst\n");
  });

  it("is a no-op to fire a section with no changes, or with an empty description", () => {
    const onProposeChange = vi.fn();
    render(<DocRenderer format="md" content={THREE_SECTION_DOC} onProposeChange={onProposeChange} />);

    const sectionZero = screen.getByTestId("doc-section-0");

    // No changes made, description filled in: Fire stays disabled.
    fireEvent.click(within(sectionZero).getByRole("button", { name: /^edit$/i }));
    fireEvent.change(within(sectionZero).getByPlaceholderText(/removed load balancers/i), {
      target: { value: "a description with no draft changes" },
    });
    const fireButton = within(sectionZero).getByRole("button", { name: /fire to harness/i });
    expect(fireButton).toBeDisabled();
    fireEvent.click(fireButton);
    expect(onProposeChange).not.toHaveBeenCalled();

    // Draft changed, but description left empty: still disabled, still a no-op.
    fireEvent.change(screen.getByTestId("doc-edit-textarea-0"), {
      target: { value: "## Section One\nchanged but no description" },
    });
    fireEvent.change(within(sectionZero).getByPlaceholderText(/removed load balancers/i), {
      target: { value: "" },
    });
    expect(within(sectionZero).getByRole("button", { name: /fire to harness/i })).toBeDisabled();
    fireEvent.click(within(sectionZero).getByRole("button", { name: /fire to harness/i }));
    expect(onProposeChange).not.toHaveBeenCalled();
  });
});
