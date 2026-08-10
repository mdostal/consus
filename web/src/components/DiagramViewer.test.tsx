import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DiagramViewer } from "./DiagramViewer";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => ({
    svg: `<svg data-testid="mock-mermaid"><text>${source}</text></svg>`,
  })),
}));

vi.mock("mermaid", () => ({
  default: mermaidMock,
}));

const repoDiagram = {
  topLevel: "graph TD\n  app[Top Level]",
  fullComponent: "graph TD\n  app[Full Component]",
};

const cascadeDiagram = {
  mermaid: "graph LR\n  seed[Seed tree]",
  cached_at: "2026-08-10T02:00:00.000Z",
  stale: false,
};

function mockFetchJson(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    }),
  );
}

describe("DiagramViewer", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mermaidMock.initialize.mockClear();
    mermaidMock.render.mockClear();
    mermaidMock.render.mockImplementation(async (_id: string, source: string) => ({
      svg: `<svg data-testid="mock-mermaid"><text>${source}</text></svg>`,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a skeleton while the diagram request is loading", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise(() => {
            // Keep the promise pending so the loading state stays visible.
          }),
      ),
    );

    render(<DiagramViewer repo="consus" />);

    expect(screen.getByLabelText("Loading diagram")).toBeTruthy();
  });

  it("renders repo top-level and full component diagrams in tabs", async () => {
    mockFetchJson(repoDiagram);

    render(<DiagramViewer repo="consus" />);

    expect(await screen.findByText(/Top Level/)).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/diagrams/consus");

    fireEvent.click(screen.getByRole("tab", { name: "Full component" }));

    expect(await screen.findByText(/Full Component/)).toBeTruthy();
    expect(screen.getByTestId("diagram-canvas").className).toContain("diagram-viewer__canvas");
  });

  it("renders the cascade org-tree diagram", async () => {
    mockFetchJson(cascadeDiagram);

    render(<DiagramViewer repo="consus" initialMode="cascade" />);

    expect(await screen.findByText(/Seed tree/)).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/diagrams/cascade");
  });

  it("shows a user-friendly message when Mermaid syntax cannot render", async () => {
    mockFetchJson({ ...repoDiagram, topLevel: "not valid mermaid" });
    mermaidMock.render.mockRejectedValueOnce(new Error("Parse error"));

    render(<DiagramViewer repo="consus" />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't render this diagram/i);
  });

  it("shows a user-friendly message when diagram loading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Unknown repo" }),
      }),
    );

    render(<DiagramViewer repo="missing" />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/Unknown repo/);
  });
});
