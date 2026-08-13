import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FireAgentTrigger } from "./FireAgentTrigger";

describe("FireAgentTrigger", () => {
  it("submits successfully with a prompt and no agent selected — agent is optional", () => {
    const onFire = vi.fn();
    render(<FireAgentTrigger onFire={onFire} />);

    fireEvent.click(screen.getByRole("button", { name: /fire agent to iterate/i }));
    fireEvent.change(screen.getByPlaceholderText(/what should the agent redo/i), { target: { value: "redo the summary" } });
    fireEvent.click(screen.getByRole("button", { name: /^fire$/i }));

    expect(onFire).toHaveBeenCalledWith({ prompt: "redo the summary" });
  });

  it("includes agentId and agentName when both are given", () => {
    const onFire = vi.fn();
    render(<FireAgentTrigger onFire={onFire} />);

    fireEvent.click(screen.getByRole("button", { name: /fire agent to iterate/i }));
    fireEvent.change(screen.getByPlaceholderText(/what should the agent redo/i), { target: { value: "redo it" } });
    fireEvent.change(screen.getByPlaceholderText(/e.g. researcher/i), { target: { value: "researcher" } });
    fireEvent.change(screen.getByPlaceholderText(/agent uuid/i), { target: { value: "agent-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^fire$/i }));

    expect(onFire).toHaveBeenCalledWith({ prompt: "redo it", agentId: "agent-1", agentName: "researcher" });
  });

  it("does not submit an empty prompt", () => {
    const onFire = vi.fn();
    render(<FireAgentTrigger onFire={onFire} />);

    fireEvent.click(screen.getByRole("button", { name: /fire agent to iterate/i }));
    expect(screen.getByRole("button", { name: /^fire$/i })).toBeDisabled();
  });

  it("shows a loud, specific error on failure — never a silent/generic one", () => {
    render(<FireAgentTrigger onFire={vi.fn()} error="Multica comment write failed: ECONNREFUSED" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Multica comment write failed: ECONNREFUSED");
  });

  it("shows the returned log_id and comment_id on success", () => {
    render(<FireAgentTrigger onFire={vi.fn()} result={{ log_id: "log-1", comment_id: "mc-1" }} />);

    expect(screen.getByText(/log-1/)).toBeInTheDocument();
    expect(screen.getByText(/mc-1/)).toBeInTheDocument();
  });
});
