import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeatureChecklist } from "./FeatureChecklist";
import type { FeatureSelectionPayload } from "./types";

const PAYLOAD: FeatureSelectionPayload = {
  version: "dostal:feature-selection/v1",
  title: "Release feature set",
  context: "Pick which features land in v2.",
  features: [
    { id: "auth", name: "Auth", description: "Login/logout flow", default: true },
    { id: "dark-mode", name: "Dark mode", description: "System-level theme toggle" },
    { id: "notifications", name: "Notifications", description: "Push alerts", default: true },
  ],
};

describe("FeatureChecklist", () => {
  it("pre-checks features where default is true", () => {
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: /auth/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /dark mode/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /notifications/i })).toBeChecked();
  });

  it("updates the count badge live as the user toggles features", () => {
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /dark mode/i }));
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /auth/i }));
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();
  });

  it("fires onVerdict with features_selected and the correct ids when Confirm is clicked", () => {
    const onVerdict = vi.fn();
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /confirm selection/i }));

    expect(onVerdict).toHaveBeenCalledOnce();
    const call = onVerdict.mock.calls[0][0];
    expect(call.kind).toBe("features_selected");
    expect(call.selected).toContain("auth");
    expect(call.selected).toContain("notifications");
    expect(call.selected).not.toContain("dark-mode");
  });

  it("fires rejected_iteration_requested with commentary when Reject is clicked", () => {
    const onVerdict = vi.fn();
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={onVerdict} />);

    const textarea = screen.getByRole("textbox", { name: /commentary/i });
    fireEvent.change(textarea, { target: { value: "Need more features first" } });
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));

    expect(onVerdict).toHaveBeenCalledWith({
      kind: "rejected_iteration_requested",
      commentary: "Need more features first",
    });
  });

  it("Reject button is disabled until commentary is entered", () => {
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={vi.fn()} />);
    expect(screen.getByRole("button", { name: /reject/i })).toBeDisabled();
  });
});
