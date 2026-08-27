import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { DirectoryBrowser } from "./DirectoryBrowser";

/** Queues one mocked fetch response per call, matching BranchPicker.test.tsx's
 *  mockFetch convention but supporting a sequence (this component issues one
 *  fetch per navigation step, not just one on mount). */
function mockFetchSequence(responses: Array<{ ok?: boolean; body: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockImplementationOnce(() =>
      Promise.resolve({ ok: r.ok ?? true, status: r.ok === false ? 500 : 200, json: async () => r.body }),
    );
  }
  return fn;
}

describe("DirectoryBrowser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches GET /api/fs/list with no path on mount and lists subdirectories", async () => {
    const fetchMock = mockFetchSequence([
      { body: { path: "/home/op", entries: [{ name: "repo-a", path: "/home/op/repo-a", isRepo: true }] } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(<DirectoryBrowser onSelect={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("repo-a")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/fs/list");
  });

  it("shows an isRepo visual hint on repo-flagged entries and not on others", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        {
          body: {
            path: "/home/op",
            entries: [
              { name: "repo-a", path: "/home/op/repo-a", isRepo: true },
              { name: "plain-dir", path: "/home/op/plain-dir", isRepo: false },
            ],
          },
        },
      ]),
    );

    render(<DirectoryBrowser onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("repo-a")).toBeInTheDocument());

    const repoButton = screen.getByText("repo-a").closest("button") as HTMLElement;
    expect(within(repoButton).getByText("repo")).toBeInTheDocument();

    const plainButton = screen.getByText("plain-dir").closest("button") as HTMLElement;
    expect(within(plainButton).queryByText("repo")).not.toBeInTheDocument();
  });

  it("navigates into a subdirectory on click, re-fetching with that path", async () => {
    const fetchMock = mockFetchSequence([
      { body: { path: "/home/op", entries: [{ name: "repo-a", path: "/home/op/repo-a", isRepo: true }] } },
      {
        body: {
          path: "/home/op/repo-a",
          entries: [{ name: "nested", path: "/home/op/repo-a/nested", isRepo: false }],
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(<DirectoryBrowser onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("repo-a")).toBeInTheDocument());

    fireEvent.click(screen.getByText("repo-a"));

    await waitFor(() => expect(screen.getByText("nested")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/fs/list?path=${encodeURIComponent("/home/op/repo-a")}`);
  });

  it("shows a breadcrumb trail and navigates back up via an earlier segment", async () => {
    const fetchMock = mockFetchSequence([
      { body: { path: "/home/op", entries: [{ name: "repo-a", path: "/home/op/repo-a", isRepo: true }] } },
      {
        body: {
          path: "/home/op/repo-a",
          entries: [{ name: "nested", path: "/home/op/repo-a/nested", isRepo: false }],
        },
      },
      { body: { path: "/home/op", entries: [{ name: "repo-a", path: "/home/op/repo-a", isRepo: true }] } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(<DirectoryBrowser onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("repo-a")).toBeInTheDocument());
    fireEvent.click(screen.getByText("repo-a"));
    await waitFor(() => expect(screen.getByText("nested")).toBeInTheDocument());

    // Breadcrumb trail should now show both "op" (home) and "repo-a".
    const homeCrumb = screen.getByRole("button", { name: "op" });
    fireEvent.click(homeCrumb);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(`/api/fs/list?path=${encodeURIComponent("/home/op")}`),
    );
  });

  it("'Select this directory' fires onSelect with the current path, regardless of isRepo", async () => {
    const onSelect = vi.fn();
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        {
          body: {
            path: "/home/op",
            entries: [{ name: "plain-dir", path: "/home/op/plain-dir", isRepo: false }],
          },
        },
      ]),
    );

    render(<DirectoryBrowser onSelect={onSelect} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("plain-dir")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Select this directory" }));

    expect(onSelect).toHaveBeenCalledWith("/home/op");
  });

  it("shows a dv__err error state (rather than crashing) when the listing fails", async () => {
    vi.stubGlobal("fetch", mockFetchSequence([{ ok: false, body: { error: "permission denied" } }]));

    render(<DirectoryBrowser onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText(/could not list directory/i)).toBeInTheDocument();
    expect(document.querySelector(".dv__err")).toBeInTheDocument();
  });

  it("fires onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([{ body: { path: "/home/op", entries: [] } }]),
    );

    render(<DirectoryBrowser onSelect={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
  });
});
