import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiagramView } from "./DiagramView";

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
  it("renders the epic/story tree with dependency edges", () => {
    render(<DiagramView repo="consus" epics={EPICS} onProposeChange={vi.fn()} />);

    expect(screen.getByText("Epic A")).toBeInTheDocument();
    expect(screen.getByText("Story One")).toBeInTheDocument();
    expect(screen.getByText(/depends on s1/)).toBeInTheDocument();
  });

  it("shows an empty state when the repo has no epics yet, not a broken view", () => {
    render(<DiagramView repo="empty-repo" epics={[]} onProposeChange={vi.fn()} />);

    expect(screen.getByText(/no epics yet/i)).toBeInTheDocument();
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
