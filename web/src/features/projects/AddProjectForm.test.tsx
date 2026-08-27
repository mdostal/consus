import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddProjectForm } from "./AddProjectForm";

/** AddProjectForm now fetches GET /api/projects/discover on mount (s5) and,
 *  once "Browse…" is clicked, DirectoryBrowser fetches GET /api/fs/list too
 *  — a single URL-aware router mock covers both, matching BranchPicker.
 *  test.tsx's mockFetch convention but dispatching on the requested path. */
function mockFetchRouter(responses: Record<string, unknown>) {
  return vi.fn((url: string) => {
    const key = Object.keys(responses).find((k) => url.startsWith(k));
    const body = key ? responses[key] : {};
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
}

const NO_CANDIDATES = { "/api/projects/discover": { candidates: [] } };

describe("AddProjectForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits the trimmed name and path", () => {
    vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
    const onSubmit = vi.fn();
    render(<AddProjectForm onSubmit={onSubmit} submitting={false} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  my-repo  " } });
    fireEvent.change(screen.getByLabelText("Repo path"), { target: { value: "  /repos/my-repo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith("my-repo", "/repos/my-repo");
  });

  it("disables the submit button until both fields are filled", () => {
    vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
    render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

    expect(screen.getByRole("button", { name: "Add project" })).toBeDisabled();
  });

  it("enables the submit button once both fields are filled", () => {
    vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
    render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "my-repo" } });
    fireEvent.change(screen.getByLabelText("Repo path"), { target: { value: "/repos/my-repo" } });

    expect(screen.getByRole("button", { name: "Add project" })).toBeEnabled();
  });

  it("shows a submitting state and disables inputs while a request is in flight", () => {
    vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
    render(<AddProjectForm onSubmit={vi.fn()} submitting />);

    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Repo path")).toBeDisabled();
  });

  it("surfaces an error message when given one", () => {
    vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
    render(<AddProjectForm onSubmit={vi.fn()} submitting={false} error="path does not exist" />);

    expect(screen.getByText("path does not exist")).toBeInTheDocument();
  });

  it("populates the discovered-repos select from GET /api/projects/discover, and choosing one fills the path field", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/projects/discover": {
          candidates: [
            { name: "sibling-a", path: "/repos/sibling-a" },
            { name: "sibling-b", path: "/repos/sibling-b" },
          ],
        },
      }),
    );

    render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "sibling-a" })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "sibling-b" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Discovered repos" }), {
      target: { value: "/repos/sibling-a" },
    });

    expect((screen.getByLabelText("Repo path") as HTMLInputElement).value).toBe("/repos/sibling-a");
  });

  it("gracefully shows only the placeholder option when discover returns zero candidates", async () => {
    vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));

    render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Discovered repos" })).toBeInTheDocument(),
    );
    const select = screen.getByRole("combobox", { name: "Discovered repos" }) as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
  });

  it("'Browse…' opens the DirectoryBrowser", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        ...NO_CANDIDATES,
        "/api/fs/list": { path: "/home/op", entries: [{ name: "repo-a", path: "/home/op/repo-a", isRepo: true }] },
      }),
    );

    render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

    expect(screen.queryByRole("button", { name: "Select this directory" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Select this directory" })).toBeInTheDocument(),
    );
    expect(await screen.findByText("repo-a")).toBeInTheDocument();
  });

  it("selecting a directory in the browser populates the path field and closes the browser", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        ...NO_CANDIDATES,
        "/api/fs/list": { path: "/home/op", entries: [] },
      }),
    );

    render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Select this directory" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Select this directory" }));

    expect((screen.getByLabelText("Repo path") as HTMLInputElement).value).toBe("/home/op");
    expect(screen.queryByRole("button", { name: "Select this directory" })).not.toBeInTheDocument();
  });

  it("the manual text input still works exactly as before, independent of discover/browse", () => {
    vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
    const onSubmit = vi.fn();
    render(<AddProjectForm onSubmit={onSubmit} submitting={false} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "typed-repo" } });
    fireEvent.change(screen.getByLabelText("Repo path"), { target: { value: "/typed/path" } });
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith("typed-repo", "/typed/path");
  });
});
