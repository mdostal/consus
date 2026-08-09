import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SectionDiff } from "./SectionDiff";

describe("SectionDiff", () => {
  it("renders a clear comparison of human vs agent text", () => {
    render(
      <SectionDiff
        humanText="## Header\nhuman brave text"
        agentText="## Header\nagent text"
        onAccept={vi.fn()}
        onSendBack={vi.fn()}
      />,
    );

    const content = screen.getByTestId("section-diff-content");
    expect(content).toHaveTextContent("Header");
    expect(content).toHaveTextContent("human");
    expect(content).toHaveTextContent("brave");
    expect(content).toHaveTextContent("agent");
  });

  it("calls onAccept when Accept Agent Changes is clicked", () => {
    const onAccept = vi.fn();
    render(<SectionDiff humanText="human" agentText="agent" onAccept={onAccept} onSendBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept Agent Changes" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("calls onSendBack when Send Back is clicked", () => {
    const onSendBack = vi.fn();
    render(<SectionDiff humanText="human" agentText="agent" onAccept={vi.fn()} onSendBack={onSendBack} />);

    fireEvent.click(screen.getByRole("button", { name: "Send Back" }));
    expect(onSendBack).toHaveBeenCalledTimes(1);
  });
});
