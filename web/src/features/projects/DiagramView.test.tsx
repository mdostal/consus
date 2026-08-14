import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

const EPICS = [
  {
    id: "epic-a",
    title: "Epic A",
    stories: [
      { id: "s1", title: "Story One", complexity: "low", dependsOn: [] },
      { id: "s2", title: "Story Two", complexity: "medium", dependsOn: ["s1"] },
    ],
  },
];

describe("DiagramView", () => {
  beforeEach(() => {
    renderMock.mockClear();
    initializeMock.mockClear();
  });

  it("renders the epic/story cascade as a Mermaid graph with dependency edges", async () => {
    render(<DiagramView repo="consus" epics={EPICS} onProposeChange={vi.fn()} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    const [, source] = renderMock.mock.calls[0];

    expect(source).toContain("graph LR");
    expect(source).toContain("Epic A");
    expect(source).toContain("Story One");
    expect(source).toContain("Story Two");
    // one edge for the s2 -> depends on -> s1 relationship
    expect(source).toMatch(/n_story_s1 --> n_story_s2/);

    expect(await screen.findByTestId("diagram-view-graph")).toHaveTextContent("graph LR");
  });

  it("shows an empty state when the repo has no epics yet, not a broken view", () => {
    render(<DiagramView repo="empty-repo" epics={[]} onProposeChange={vi.fn()} />);

    expect(screen.getByText(/no epics yet/i)).toBeInTheDocument();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it("shows a friendly fallback message when mermaid.render() fails", async () => {
    renderMock.mockRejectedValueOnce(new Error("parse error"));

    render(<DiagramView repo="consus" epics={EPICS} onProposeChange={vi.fn()} />);

    expect(await screen.findByText(/couldn't render this diagram/i)).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-view-graph")).not.toBeInTheDocument();
  });

  it("composing a change: propose action reveals a diff + description form", () => {
    render(<DiagramView repo="consus" epics={EPICS} onProposeChange={vi.fn()} />);

    expect(screen.queryByPlaceholderText(/added x/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));
    expect(screen.getByPlaceholderText(/added x/i)).toBeInTheDocument();
  });

  it("firing a proposal: calls onProposeChange with the composed diff and description", () => {
    const onProposeChange = vi.fn();
    render(<DiagramView repo="consus" epics={EPICS} onProposeChange={onProposeChange} />);

    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));
    fireEvent.change(screen.getByPlaceholderText(/removed load balancers/i), {
      target: { value: "removed the load balancer node" },
    });
    fireEvent.change(screen.getByPlaceholderText(/added x/i), { target: { value: "- load-balancer\n+ direct" } });
    fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

    expect(onProposeChange).toHaveBeenCalledWith({
      diff: "- load-balancer\n+ direct",
      description: "removed the load balancer node",
    });
  });

  it("firing a proposal closes the compose form", () => {
    render(<DiagramView repo="consus" epics={EPICS} onProposeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));
    fireEvent.change(screen.getByPlaceholderText(/removed load balancers/i), { target: { value: "d" } });
    fireEvent.change(screen.getByPlaceholderText(/added x/i), { target: { value: "diff" } });
    fireEvent.click(screen.getByRole("button", { name: /fire to harness/i }));

    expect(screen.queryByPlaceholderText(/added x/i)).not.toBeInTheDocument();
  });

  it("disables firing until both description and diff are filled in", () => {
    render(<DiagramView repo="consus" epics={EPICS} onProposeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));
    expect(screen.getByRole("button", { name: /fire to harness/i })).toBeDisabled();
  });

  it("shows a pending indicator when a proposal is in flight", () => {
    render(<DiagramView repo="consus" epics={EPICS} pendingProposal onProposeChange={vi.fn()} />);

    expect(screen.getByText(/change proposed/i)).toBeInTheDocument();
  });
});
