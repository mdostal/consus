import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocDiffCheck } from "./DocDiffCheck";

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(() => Promise.resolve({ ok, status, json: async () => body }));
}

describe("DocDiffCheck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the 'View diff vs default branch' action, and fires no request until clicked", () => {
    const fetchMock = mockFetch({ diff: "some diff" });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocDiffCheck repo="consus" path="architecture.md" branch="feature/x" />);

    expect(screen.getByRole("button", { name: "View diff vs default branch" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AC3: clicking renders the diff via the same plain <pre data-testid=\"...\"> pattern EventProposeComposer uses", async () => {
    const fetchMock = mockFetch({ diff: "- old line\n+ new line" });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocDiffCheck repo="consus" path="architecture.md" branch="feature/x" />);
    fireEvent.click(screen.getByRole("button", { name: "View diff vs default branch" }));

    const pre = await screen.findByTestId("doc-diff");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe("- old line\n+ new line");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/docs/diff?repo=consus&path=architecture.md&ref=feature%2Fx",
    );
  });

  it("AC4: a null diff (identical on both branches) shows a clear 'no changes' indication, not a silent no-op", async () => {
    vi.stubGlobal("fetch", mockFetch({ diff: null }));

    render(<DocDiffCheck repo="consus" path="architecture.md" branch="feature/x" />);
    fireEvent.click(screen.getByRole("button", { name: "View diff vs default branch" }));

    expect(await screen.findByTestId("doc-diff-none")).toHaveTextContent(
      'No changes on "feature/x" vs the default branch.',
    );
    expect(screen.queryByTestId("doc-diff")).not.toBeInTheDocument();
  });

  it("shows a visible error when the diff request fails, rather than failing silently", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "could not determine default branch" }, false, 400));

    render(<DocDiffCheck repo="consus" path="architecture.md" branch="feature/x" />);
    fireEvent.click(screen.getByRole("button", { name: "View diff vs default branch" }));

    expect(await screen.findByText(/could not determine default branch/)).toBeInTheDocument();
  });

  it("disables the button while the request is in flight", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    render(<DocDiffCheck repo="consus" path="architecture.md" branch="feature/x" />);
    fireEvent.click(screen.getByRole("button", { name: "View diff vs default branch" }));

    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());

    resolveFetch({ ok: true, status: 200, json: async () => ({ diff: null }) });
  });
});
