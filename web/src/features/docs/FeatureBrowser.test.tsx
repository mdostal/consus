import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { FeatureBrowser, type Feature, type FeatureDoc } from "./FeatureBrowser";

const FEATURES: Feature[] = [
  {
    epic: "sample-epic",
    docCount: 2,
    docs: [
      { repo: "consus", file_path: ".pHive/epics/sample-epic/docs/prd.md", content_hash: "abc", last_scanned_at: "2026-07-25T00:00:00Z" },
      { repo: "consus", file_path: ".pHive/epics/sample-epic/docs/architecture.md", content_hash: "def", last_scanned_at: "2026-07-25T00:00:00Z" },
    ],
  },
  {
    epic: "other-epic",
    docCount: 1,
    docs: [{ repo: "consus", file_path: ".pHive/epics/other-epic/docs/design.md", content_hash: "ghi", last_scanned_at: "2026-07-25T00:00:00Z" }],
  },
];

const OVERVIEW: FeatureDoc[] = [
  { repo: "consus", file_path: "README.md", content_hash: "jkl", last_scanned_at: "2026-07-25T00:00:00Z" },
];

describe("FeatureBrowser", () => {
  it("lists one row per feature (epic) with a real doc count, not a flat per-doc list", () => {
    render(<FeatureBrowser features={FEATURES} overview={[]} onSelectFeature={vi.fn()} onOpenDoc={vi.fn()} />);

    expect(screen.getByText("sample-epic")).toBeInTheDocument();
    expect(screen.getByText("2 docs")).toBeInTheDocument();
    expect(screen.getByText("other-epic")).toBeInTheDocument();
    expect(screen.getByText("1 doc")).toBeInTheDocument();

    // The individual doc paths themselves are not rendered at this level —
    // they only appear once a feature is opened (FeatureDetailView).
    expect(screen.queryByText(/prd\.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(/architecture\.md/)).not.toBeInTheDocument();
  });

  it("calls onSelectFeature with the full feature (epic, docCount, docs) when a feature row is clicked", () => {
    const onSelectFeature = vi.fn();
    render(<FeatureBrowser features={FEATURES} overview={[]} onSelectFeature={onSelectFeature} onOpenDoc={vi.fn()} />);

    fireEvent.click(screen.getByText("sample-epic"));

    expect(onSelectFeature).toHaveBeenCalledWith(FEATURES[0]);
  });

  it("renders the Overview section visually distinct from the feature list, listing overview docs", () => {
    render(<FeatureBrowser features={FEATURES} overview={OVERVIEW} onSelectFeature={vi.fn()} onOpenDoc={vi.fn()} />);

    const featuresSection = screen.getByText("Features").closest("section");
    const overviewSection = screen.getByText("Overview").closest("section");
    expect(featuresSection).not.toBe(overviewSection);
    expect(overviewSection?.className).toContain("feature-browser__overview");

    expect(within(overviewSection as HTMLElement).getByText("README.md")).toBeInTheDocument();
  });

  it("calls onOpenDoc with the doc's repo and file_path when an overview doc is clicked", () => {
    const onOpenDoc = vi.fn();
    render(<FeatureBrowser features={[]} overview={OVERVIEW} onSelectFeature={vi.fn()} onOpenDoc={onOpenDoc} />);

    fireEvent.click(screen.getByText("README.md"));

    expect(onOpenDoc).toHaveBeenCalledWith("consus", "README.md");
  });

  it("shows an empty message for each section when there are no features and no overview docs", () => {
    render(<FeatureBrowser features={[]} overview={[]} onSelectFeature={vi.fn()} onOpenDoc={vi.fn()} />);

    expect(screen.getByText(/no feature docs indexed yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no overview docs indexed yet/i)).toBeInTheDocument();
  });
});
