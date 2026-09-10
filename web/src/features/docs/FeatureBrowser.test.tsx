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

describe("FeatureBrowser — Brand section (s3 of consus-phase29-brand-decision-review)", () => {
  const BRAND: FeatureDoc[] = [
    { repo: "consus", file_path: ".pHive/brand/brand-guide.html", content_hash: "mno", last_scanned_at: "2026-09-10T00:00:00Z" },
  ];

  it("renders a Brand section as a sibling to Overview, not nested inside it", () => {
    render(<FeatureBrowser features={[]} overview={OVERVIEW} brand={BRAND} onSelectFeature={vi.fn()} onOpenDoc={vi.fn()} />);

    const overviewSection = screen.getByText("Overview").closest("section");
    const brandSection = screen.getByText("Brand").closest("section");
    expect(brandSection).not.toBe(overviewSection);
    expect(brandSection?.className).toContain("feature-browser__brand");
    // Not a child of the Overview section.
    expect(overviewSection?.contains(brandSection as Node)).toBe(false);

    expect(within(brandSection as HTMLElement).getByText(".pHive/brand/brand-guide.html")).toBeInTheDocument();
  });

  it("calls onOpenDoc with the doc's repo and file_path when a brand doc is clicked", () => {
    const onOpenDoc = vi.fn();
    render(<FeatureBrowser features={[]} overview={[]} brand={BRAND} onSelectFeature={vi.fn()} onOpenDoc={onOpenDoc} />);

    fireEvent.click(screen.getByText(".pHive/brand/brand-guide.html"));

    expect(onOpenDoc).toHaveBeenCalledWith("consus", ".pHive/brand/brand-guide.html");
  });

  it("shows an empty message for the Brand section when there are no brand docs", () => {
    render(<FeatureBrowser features={[]} overview={[]} brand={[]} onSelectFeature={vi.fn()} onOpenDoc={vi.fn()} />);
    expect(screen.getByText(/no brand docs indexed yet/i)).toBeInTheDocument();
  });

  it("defaults to an empty Brand section when the brand prop is omitted entirely — every pre-existing caller keeps working unchanged", () => {
    render(<FeatureBrowser features={[]} overview={[]} onSelectFeature={vi.fn()} onOpenDoc={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Brand" })).toBeInTheDocument();
    expect(screen.getByText(/no brand docs indexed yet/i)).toBeInTheDocument();
  });
});

describe("FeatureBrowser — design topic surfacing (s3 of consus-phase28-interaction-completeness)", () => {
  const FEATURES_WITH_DESIGN: Feature[] = [
    {
      epic: "checkout-flow",
      docCount: 2,
      docs: [
        {
          repo: "consus",
          file_path: ".pHive/epics/checkout-flow/docs/architecture.md",
          content_hash: "abc",
          last_scanned_at: "2026-07-25T00:00:00Z",
        },
        {
          repo: "consus",
          file_path: ".pHive/design/checkout-flow/brief.md",
          content_hash: "def",
          last_scanned_at: "2026-07-25T00:00:00Z",
        },
      ],
    },
    {
      epic: "no-design-feature",
      docCount: 1,
      docs: [
        {
          repo: "consus",
          file_path: ".pHive/epics/no-design-feature/docs/prd.md",
          content_hash: "ghi",
          last_scanned_at: "2026-07-25T00:00:00Z",
        },
      ],
    },
  ];

  it("shows a Design badge on a feature row whose docs include a .pHive/design/ topic, not as a separate nav item", () => {
    render(
      <FeatureBrowser features={FEATURES_WITH_DESIGN} overview={[]} onSelectFeature={vi.fn()} onOpenDoc={vi.fn()} />,
    );

    const checkoutRow = screen.getByText("checkout-flow").closest("li")!;
    expect(within(checkoutRow).getByText("Design")).toBeInTheDocument();

    const otherRow = screen.getByText("no-design-feature").closest("li")!;
    expect(within(otherRow).queryByText("Design")).not.toBeInTheDocument();

    // Still exactly two top-level sections (Features, Overview) — no third
    // "Design" nav item was introduced.
    expect(screen.getByRole("heading", { name: "Features" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^design$/i })).not.toBeInTheDocument();
  });
});
