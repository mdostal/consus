import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeatureDetailView } from "./FeatureDetailView";
import type { FeatureDoc } from "./FeatureBrowser";

const TWO_DOCS: FeatureDoc[] = [
  { repo: "consus", file_path: ".pHive/epics/sample-epic/docs/prd.md", content_hash: "abc", last_scanned_at: "2026-07-25T00:00:00Z" },
  { repo: "consus", file_path: ".pHive/epics/sample-epic/docs/architecture.md", content_hash: "def", last_scanned_at: "2026-07-25T00:00:00Z" },
];

function fetchMockFor(content: Record<string, { format: "md" | "html"; content: string }>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const params = new URLSearchParams(url.split("?")[1]);
    const path = params.get("path") ?? "";
    const body = content[path];
    if (!body) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
    return Promise.resolve({ ok: true, json: async () => body });
  });
}

describe("FeatureDetailView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and renders every doc belonging to the feature together on one screen", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "PRD" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(screen.getByText(".pHive/epics/sample-epic/docs/prd.md")).toBeInTheDocument();
    expect(screen.getByText(".pHive/epics/sample-epic/docs/architecture.md")).toBeInTheDocument();
  });

  it("shows the epic name and doc count in its header", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "sample-epic" })).toBeInTheDocument();
    expect(screen.getByText("2 docs")).toBeInTheDocument();
  });

  it("calls onBack when the back control is clicked", () => {
    vi.stubGlobal("fetch", fetchMockFor({}));
    const onBack = vi.fn();

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: /back to features/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it("does not wire an onProposeChange into DocRenderer — this story is read-only, approve/deny/change is s4", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    await screen.findByRole("heading", { name: "PRD" });
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("gives each doc its own 'view diff vs default branch' action when a branch is passed", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} branch="feature/x" />);

    await screen.findByRole("heading", { name: "PRD" });
    expect(screen.getAllByRole("button", { name: "View diff vs default branch" })).toHaveLength(2);
  });

  it("omits the diff action entirely when no branch is passed", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    await screen.findByRole("heading", { name: "PRD" });
    expect(screen.queryByRole("button", { name: "View diff vs default branch" })).not.toBeInTheDocument();
  });

  it("shows a per-doc error when one doc's content fails to load, without blocking the others", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/could not load .*prd\.md/i)).toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: "Architecture" })).toBeInTheDocument();
  });
});
