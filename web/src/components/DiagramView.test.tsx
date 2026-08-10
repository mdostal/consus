import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramView } from "./DiagramView";

const { initializeMock, renderMock } = vi.hoisted(() => ({
  initializeMock: vi.fn(),
  renderMock: vi.fn(async (_id: string, source: string) => ({
    svg: `<svg data-testid="rendered-svg"><text>${source}</text></svg>`,
    bindFunctions: vi.fn(),
  })),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

function mockFetch(json: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => json,
  })) as unknown as typeof fetch;
}

describe("DiagramView", () => {
  beforeEach(() => {
    renderMock.mockClear();
    initializeMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a repo architecture diagram, renders top-level Mermaid, and toggles to full", async () => {
    const fetchMock = mockFetch({
      topLevel: "graph TD\n  root --> web",
      fullComponent: "graph TD\n  root --> web\n  web --> components",
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiagramView repo_id="consus" type="repo-architecture" />);

    expect(screen.getByTestId("diagram-skeleton")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/diagrams/consus"));
    await waitFor(() => expect(renderMock).toHaveBeenCalledWith(expect.stringMatching(/^consus-diagram-/), "graph TD\n  root --> web"));

    fireEvent.click(screen.getByRole("button", { name: "Full" }));

    await waitFor(() =>
      expect(renderMock).toHaveBeenLastCalledWith(
        expect.stringMatching(/^consus-diagram-/),
        "graph TD\n  root --> web\n  web --> components",
      ),
    );
    expect(screen.getByRole("button", { name: "Full" })).toHaveAttribute("aria-pressed", "true");
  });

  it("fetches the cascade endpoint and renders the org-tree Mermaid source", async () => {
    const fetchMock = mockFetch({ mermaid: "graph LR\n  seed --> story" });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiagramView type="cascade" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/diagrams/cascade"));
    await waitFor(() => expect(renderMock).toHaveBeenCalledWith(expect.stringMatching(/^consus-diagram-/), "graph LR\n  seed --> story"));
    expect(screen.queryByRole("button", { name: "Full" })).not.toBeInTheDocument();
  });

  it("shows an accessible error state when the API request fails", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "unknown repo: missing" }, false, 404));

    render(<DiagramView repo_id="missing" type="repo-architecture" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("unknown repo: missing");
    expect(renderMock).not.toHaveBeenCalled();
  });

  it("shows an error before fetching when repo_id is missing for architecture diagrams", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<DiagramView type="repo-architecture" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("repo_id is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to Mermaid source text when client-side rendering fails", async () => {
    vi.stubGlobal("fetch", mockFetch({ mermaid: "graph LR\n  seed --> story" }));
    renderMock.mockRejectedValueOnce(new Error("Mermaid parse failed"));

    render(<DiagramView type="cascade" />);

    const diagram = await screen.findByTestId("diagram-mermaid");
    await waitFor(() => expect(diagram).toHaveTextContent("graph LR seed --> story"));
  });

  it("renders generated SVG into a stable scrollable diagram container for visual regression", async () => {
    vi.stubGlobal("fetch", mockFetch({ mermaid: "graph LR\n  seed --> story" }));

    render(<DiagramView type="cascade" />);

    const diagram = await screen.findByTestId("diagram-mermaid");
    await waitFor(() => expect(diagram.querySelector("svg")).toBeInTheDocument());
    expect(diagram).toHaveAttribute("role", "img");
    expect(diagram).toHaveStyle({ minHeight: "320px", overflow: "auto" });

    await act(async () => {});
  });
});
