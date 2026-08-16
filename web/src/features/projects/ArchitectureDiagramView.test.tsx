import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ArchitectureDiagramView } from "./ArchitectureDiagramView";

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

const TOP_LEVEL = 'graph TD\n  root["consus"]\n  root --> src["src"]';
const FULL_COMPONENT = 'graph TD\n  root["consus"]\n  root --> src["src"]\n  src --> src_index["index.ts"]';

describe("ArchitectureDiagramView", () => {
  beforeEach(() => {
    renderMock.mockClear();
    initializeMock.mockClear();
  });

  it("renders given { repo, topLevel, fullComponent } props", async () => {
    render(<ArchitectureDiagramView repo="consus" topLevel={TOP_LEVEL} fullComponent={FULL_COMPONENT} />);

    expect(screen.getByText(/consus — architecture diagram/i)).toBeInTheDocument();

    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    const [, source] = renderMock.mock.calls[0];
    expect(source).toBe(TOP_LEVEL);

    expect(await screen.findByTestId("architecture-diagram-view-graph-top-level")).toHaveTextContent("graph TD");
  });

  it("switches to the full-component graph when that tab is selected", async () => {
    render(<ArchitectureDiagramView repo="consus" topLevel={TOP_LEVEL} fullComponent={FULL_COMPONENT} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("tab", { name: /full component/i }));

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(2));
    const [, source] = renderMock.mock.calls[1];
    expect(source).toBe(FULL_COMPONENT);
    expect(await screen.findByTestId("architecture-diagram-view-graph-full-component")).toBeInTheDocument();
  });

  it("shows a friendly fallback message when mermaid.render() fails", async () => {
    renderMock.mockRejectedValueOnce(new Error("parse error"));

    render(<ArchitectureDiagramView repo="consus" topLevel={TOP_LEVEL} fullComponent={FULL_COMPONENT} />);

    expect(await screen.findByText(/couldn't render this diagram/i)).toBeInTheDocument();
  });

  it("does not import from DiagramView.tsx", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "ArchitectureDiagramView.tsx"), "utf-8");
    expect(source).not.toMatch(/from ["']\.\/DiagramView/);
  });
});
