import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddProjectForm } from "./AddProjectForm";

// consus-phase28 follow-up: isTauri() and invoke() are both module-level
// imports (see AddProjectForm.tsx) — mocked here so tests can toggle
// "running inside the desktop app" per-test via vi.mocked(isTauri), and
// assert on what the native picker does without an actual Tauri runtime
// (which doesn't exist under vitest/jsdom). invoke() calls the app's own
// `pick_repo_folder` command (lib.rs), not @tauri-apps/plugin-dialog's
// open() directly — see AddProjectForm.tsx's browseNative() docstring for
// why (the plugin's own parented panel silently never became visible).
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => false), invoke: vi.fn() }));

import { isTauri, invoke } from "@tauri-apps/api/core";

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

  // consus-phase28 follow-up: found live on the desktop app — none of the
  // three non-typed path sources ever filled Name, so the submit button
  // silently stayed disabled with nothing on screen explaining why. These
  // tests are the regression coverage for the fix.
  describe("name auto-fill (consus-phase28 follow-up)", () => {
    it("choosing a discovered repo also fills Name from the candidate's own name, unblocking submit with zero typing", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetchRouter({
          "/api/projects/discover": { candidates: [{ name: "sibling-a", path: "/repos/sibling-a" }] },
        }),
      );
      const onSubmit = vi.fn();
      render(<AddProjectForm onSubmit={onSubmit} submitting={false} />);

      await waitFor(() => expect(screen.getByRole("option", { name: "sibling-a" })).toBeInTheDocument());
      fireEvent.change(screen.getByRole("combobox", { name: "Discovered repos" }), {
        target: { value: "/repos/sibling-a" },
      });

      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("sibling-a");
      expect(screen.getByRole("button", { name: "Add project" })).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: "Add project" }));
      expect(onSubmit).toHaveBeenCalledWith("sibling-a", "/repos/sibling-a");
    });

    it("selecting a directory in the browser fills Name from the folder's basename, sanitized to a valid project name", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetchRouter({ ...NO_CANDIDATES, "/api/fs/list": { path: "/home/op", entries: [] } }),
      );
      render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Select this directory" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Select this directory" }));

      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("op");
    });

    it("never overwrites a Name the operator already typed", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetchRouter({
          "/api/projects/discover": { candidates: [{ name: "sibling-a", path: "/repos/sibling-a" }] },
        }),
      );
      render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "my-own-name" } });
      await waitFor(() => expect(screen.getByRole("option", { name: "sibling-a" })).toBeInTheDocument());
      fireEvent.change(screen.getByRole("combobox", { name: "Discovered repos" }), {
        target: { value: "/repos/sibling-a" },
      });

      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("my-own-name");
    });
  });

  describe("native folder picker (consus-phase28 follow-up)", () => {
    afterEach(() => {
      vi.mocked(isTauri).mockReturnValue(false);
      vi.mocked(invoke).mockReset();
    });

    it("does not render 'Open in Finder…' outside the desktop app (isTauri() false)", () => {
      vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
      render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

      expect(screen.queryByRole("button", { name: "Open in Finder…" })).not.toBeInTheDocument();
    });

    it("renders 'Open in Finder…' inside the desktop app and fills path+name from pick_repo_folder's result", async () => {
      vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
      vi.mocked(isTauri).mockReturnValue(true);
      vi.mocked(invoke).mockResolvedValue("/Users/me/code/my-repo");

      render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Open in Finder…" }));

      await waitFor(() => expect((screen.getByLabelText("Repo path") as HTMLInputElement).value).toBe("/Users/me/code/my-repo"));
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("my-repo");
      expect(invoke).toHaveBeenCalledWith("pick_repo_folder");
    });

    it("surfaces an error instead of crashing if the native command rejects", async () => {
      vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
      vi.mocked(isTauri).mockReturnValue(true);
      vi.mocked(invoke).mockRejectedValue(new Error("dialog unavailable"));

      render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Open in Finder…" }));

      expect(await screen.findByText("dialog unavailable")).toBeInTheDocument();
    });

    it("does nothing if the operator cancels the native dialog (null result)", async () => {
      vi.stubGlobal("fetch", mockFetchRouter(NO_CANDIDATES));
      vi.mocked(isTauri).mockReturnValue(true);
      vi.mocked(invoke).mockResolvedValue(null);

      render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Open in Finder…" }));

      await waitFor(() => expect(invoke).toHaveBeenCalled());
      expect((screen.getByLabelText("Repo path") as HTMLInputElement).value).toBe("");
    });
  });
});
