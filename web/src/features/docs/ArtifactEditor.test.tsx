import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactEditor } from "./ArtifactEditor";
import * as kbApi from "../../api/kb";

vi.mock("../../api/kb", () => ({
  fetchKbDrafts: vi.fn(),
  saveKbDraft: vi.fn(),
  submitKbEntry: vi.fn(),
}));

describe("ArtifactEditor", () => {
  const initialContent = "# Header 1\nSection 1 text\n## Header 2\nSection 2 text";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders distinct sections from initialContent when no drafts exist", async () => {
    vi.mocked(kbApi.fetchKbDrafts).mockResolvedValue([]);
    render(<ArtifactEditor id="doc-1" initialContent={initialContent} />);
    
    await waitFor(() => {
      expect(screen.queryByText("Loading document...")).not.toBeInTheDocument();
    });

    // Each section gets an Edit Section button
    const editButtons = screen.getAllByRole("button", { name: "Edit Section" });
    expect(editButtons).toHaveLength(2);
  });

  it("preserves durable draft edits by auto-fetching drafts on initial load", async () => {
    const draftContent = "# Header 1\nDraft edited text\n## Header 2\nDraft section 2";
    vi.mocked(kbApi.fetchKbDrafts).mockResolvedValue([
      { id: 1, kb_entry_id: "doc-1", author: "user", content: draftContent, state: "draft", created_at: "now" }
    ]);

    render(<ArtifactEditor id="doc-1" initialContent={initialContent} />);
    
    await waitFor(() => {
      expect(screen.queryByText("Loading document...")).not.toBeInTheDocument();
    });

    // Ensure the draft text is rendered instead of initial content
    expect(screen.getByText("Draft edited text")).toBeInTheDocument();
  });

  it("has explicit Save and Submit buttons that call the backend APIs", async () => {
    vi.mocked(kbApi.fetchKbDrafts).mockResolvedValue([]);
    render(<ArtifactEditor id="doc-1" initialContent={initialContent} />);
    
    await waitFor(() => {
      expect(screen.queryByText("Loading document...")).not.toBeInTheDocument();
    });

    const saveButton = screen.getByRole("button", { name: "Save" });
    const submitButton = screen.getByRole("button", { name: "Submit" });

    expect(saveButton).toBeInTheDocument();
    expect(submitButton).toBeInTheDocument();

    fireEvent.click(saveButton);
    expect(kbApi.saveKbDraft).toHaveBeenCalledWith("doc-1", "user", initialContent);

    fireEvent.click(submitButton);
    expect(kbApi.submitKbEntry).toHaveBeenCalledWith("doc-1", "user", initialContent);
  });

  it("allows toggling edit mode for a specific section", async () => {
    vi.mocked(kbApi.fetchKbDrafts).mockResolvedValue([]);
    render(<ArtifactEditor id="doc-1" initialContent={initialContent} />);
    
    await waitFor(() => {
      expect(screen.queryByText("Loading document...")).not.toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole("button", { name: "Edit Section" });
    fireEvent.click(editButtons[0]);

    // Should now show a textarea and a Done button
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    
    fireEvent.change(textarea, { target: { value: "# Header 1\nModified Section 1\n" } });
    
    const doneButton = screen.getByRole("button", { name: "Done" });
    fireEvent.click(doneButton);

    // Save should now send the updated content
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    expect(kbApi.saveKbDraft).toHaveBeenCalledWith("doc-1", "user", "# Header 1\nModified Section 1\n## Header 2\nSection 2 text");
  });
});
