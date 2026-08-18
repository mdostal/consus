import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { DiagramMetadataStrip, OPERATOR_NAME, formatMetadataDate } from "./DiagramMetadataStrip";
import { __resetDiagramRevisionForTests, incrementDiagramRevision } from "./diagramRevisionCounter";

const FIXED_DATE = new Date(2026, 0, 15); // local time, avoids UTC/locale flakiness

function setSkin(skin: string | null) {
  if (skin === null) document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", skin);
}

afterEach(() => {
  __resetDiagramRevisionForTests();
  setSkin(null);
});

/**
 * DiagramMetadataStrip (s5, consus-phase18, design-discussion.md resolved
 * decision #9) — ONE component, ONE shared data source (revision count,
 * operator, date, repo), presented three different ways depending on the
 * active skin.
 */
describe("DiagramMetadataStrip — one shared component, three skins of the same data", () => {
  it("renders the same top-level component (single wrapper testid) regardless of active skin — real identity, not just similar-looking markup", () => {
    for (const skin of ["drafting", "case-board", "harness"]) {
      setSkin(skin);
      const { unmount } = render(<DiagramMetadataStrip repo="consus" date={FIXED_DATE} />);
      const strip = screen.getByTestId("diagram-metadata-strip");
      expect(strip).toBeInTheDocument();
      expect(strip.className).toContain("diagram-metadata-strip");
      expect(strip.className).toContain(`diagram-metadata-strip--${skin}`);
      unmount();
    }
  });

  it("renders Drafting Table's title block (SHEET/PROJECT/SCALE/REV/DRAWN/DATE) only when skin is 'drafting'", () => {
    setSkin("drafting");
    render(<DiagramMetadataStrip repo="consus" date={FIXED_DATE} />);
    expect(screen.getByTestId("diagram-metadata-strip-drafting")).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-metadata-strip-case-board")).not.toBeInTheDocument();
    expect(screen.queryByTestId("diagram-metadata-strip-harness")).not.toBeInTheDocument();
  });

  it("renders Case Board's CASE NO. stamp only when skin is 'case-board'", () => {
    setSkin("case-board");
    render(<DiagramMetadataStrip repo="consus" date={FIXED_DATE} />);
    expect(screen.getByTestId("diagram-metadata-strip-case-board")).toBeInTheDocument();
    expect(screen.getByText("CASE NO.")).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-metadata-strip-drafting")).not.toBeInTheDocument();
    expect(screen.queryByTestId("diagram-metadata-strip-harness")).not.toBeInTheDocument();
  });

  it("renders Harness's footer status line only when skin is 'harness'", () => {
    setSkin("harness");
    render(<DiagramMetadataStrip repo="consus" date={FIXED_DATE} />);
    expect(screen.getByTestId("diagram-metadata-strip-harness")).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-metadata-strip-drafting")).not.toBeInTheDocument();
    expect(screen.queryByTestId("diagram-metadata-strip-case-board")).not.toBeInTheDocument();
  });

  it("defaults to Drafting Table's rendering when no [data-skin] is applied at all (same DEFAULT_SKIN fallback as useSkinPreference)", () => {
    render(<DiagramMetadataStrip repo="consus" date={FIXED_DATE} />);
    expect(screen.getByTestId("diagram-metadata-strip-drafting")).toBeInTheDocument();
  });

  it("shows the real operator, repo, and formatted date in every skin's rendering — same data, different presentation", () => {
    for (const skin of ["drafting", "case-board", "harness"]) {
      setSkin(skin);
      const { unmount } = render(<DiagramMetadataStrip repo="my-repo" date={FIXED_DATE} />);
      const strip = screen.getByTestId("diagram-metadata-strip");
      expect(strip).toHaveTextContent("my-repo");
      expect(strip).toHaveTextContent(OPERATOR_NAME);
      expect(strip).toHaveTextContent(formatMetadataDate(FIXED_DATE));
      unmount();
    }
  });

  describe("revision/fire count — same underlying counter, reflected identically regardless of active skin", () => {
    it("shows 0 with nothing fired yet, in every skin", () => {
      for (const skin of ["drafting", "case-board", "harness"]) {
        setSkin(skin);
        const { unmount } = render(<DiagramMetadataStrip repo="consus" date={FIXED_DATE} />);
        expect(screen.getByTestId("diagram-metadata-strip-revision")).toHaveTextContent("0");
        unmount();
      }
    });

    it("reflects the exact same incremented count in every skin's own rendering", () => {
      incrementDiagramRevision();
      incrementDiagramRevision();
      incrementDiagramRevision();

      for (const skin of ["drafting", "case-board", "harness"]) {
        setSkin(skin);
        const { unmount } = render(<DiagramMetadataStrip repo="consus" date={FIXED_DATE} />);
        const strip = screen.getByTestId("diagram-metadata-strip");
        expect(within(strip).getByTestId("diagram-metadata-strip-revision")).toHaveTextContent("3");
        unmount();
      }
    });

    it("updates live when the shared counter changes while mounted, without remounting", () => {
      setSkin("harness");
      render(<DiagramMetadataStrip repo="consus" date={FIXED_DATE} />);
      expect(screen.getByTestId("diagram-metadata-strip-revision")).toHaveTextContent("0");

      act(() => incrementDiagramRevision());

      expect(screen.getByTestId("diagram-metadata-strip-revision")).toHaveTextContent("1");
    });
  });

  it("reacts live to a [data-skin] attribute change on the document root after mount (the same live-attribute mechanism CaseBoardCorkTexture.tsx already uses), not just its value at mount time", async () => {
    setSkin("drafting");
    render(<DiagramMetadataStrip repo="consus" date={FIXED_DATE} />);
    expect(screen.getByTestId("diagram-metadata-strip-drafting")).toBeInTheDocument();

    setSkin("harness");

    expect(await screen.findByTestId("diagram-metadata-strip-harness")).toBeInTheDocument();
  });
});
