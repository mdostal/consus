import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { BranchPicker } from "./BranchPicker";

function mockFetch(body: unknown, ok = true) {
  return vi.fn(() => Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body }));
}

describe("BranchPicker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always shows '(default)' as the first option, even before the fetch resolves", () => {
    vi.stubGlobal("fetch", mockFetch({ branches: [] }));

    render(<BranchPicker project="consus" value={null} onChange={vi.fn()} />);

    const select = screen.getByRole("combobox", { name: "Select branch" });
    expect(within(select).getByText("(default)")).toBeInTheDocument();
  });

  it("fetches GET /api/projects/:project/branches and lists the returned branches as options", async () => {
    const fetchMock = mockFetch({ branches: ["feature/x", "feature/y"] });
    vi.stubGlobal("fetch", fetchMock);

    render(<BranchPicker project="consus" value={null} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "feature/x" })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "feature/y" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/consus/branches");
  });

  it("calls onChange with the branch name when a non-default option is selected", async () => {
    vi.stubGlobal("fetch", mockFetch({ branches: ["feature/x"] }));
    const onChange = vi.fn();

    render(<BranchPicker project="consus" value={null} onChange={onChange} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "feature/x" })).toBeInTheDocument());

    fireEvent.change(screen.getByRole("combobox", { name: "Select branch" }), { target: { value: "feature/x" } });

    expect(onChange).toHaveBeenCalledWith("feature/x");
  });

  it("calls onChange with null when '(default)' is selected", async () => {
    vi.stubGlobal("fetch", mockFetch({ branches: ["feature/x"] }));
    const onChange = vi.fn();

    render(<BranchPicker project="consus" value="feature/x" onChange={onChange} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "feature/x" })).toBeInTheDocument());

    fireEvent.change(screen.getByRole("combobox", { name: "Select branch" }), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("AC5: gracefully shows only '(default)' when the project has zero non-default branches — no crash", async () => {
    vi.stubGlobal("fetch", mockFetch({ branches: [] }));

    render(<BranchPicker project="consus" value={null} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Select branch" })).toBeInTheDocument());
    const select = screen.getByRole("combobox", { name: "Select branch" }) as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(select.options[0].textContent).toBe("(default)");
  });

  it("shows a visible error but still renders the '(default)' option when the branches fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "boom" }, false));

    render(<BranchPicker project="consus" value={null} onChange={vi.fn()} />);

    expect(await screen.findByText(/could not load branches/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "(default)" })).toBeInTheDocument();
  });
});
