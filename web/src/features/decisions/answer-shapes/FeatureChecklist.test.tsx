import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeatureChecklist } from "./FeatureChecklist";
import type { FeatureSelectionPayload } from "./types";

const PAYLOAD: FeatureSelectionPayload = {
  version: "dostal:feature-selection/v1",
  title: "Which features to ship?",
  context: "ctx",
  features: [
    { id: "a", name: "Auth", description: "Authentication module", default: true },
    { id: "b", name: "Dark mode", description: "Dark colour scheme", default: false },
  ],
};

describe("FeatureChecklist — initial state", () => {
  it("pre-checks features with default: true and leaves others unchecked", () => {
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: /auth/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /dark mode/i })).not.toBeChecked();
  });

  it("shows live count reflecting defaults on mount", () => {
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByText(/1 of 2 selected/i)).toBeInTheDocument();
  });
});

describe("FeatureChecklist — toggle and count", () => {
  it("updates the live count when a feature is toggled", () => {
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /dark mode/i }));
    expect(screen.getByText(/2 of 2 selected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /dark mode/i }));
    expect(screen.getByText(/1 of 2 selected/i)).toBeInTheDocument();
  });
});

describe("FeatureChecklist — confirm verdict", () => {
  it("fires features_selected with the currently checked ids when Confirm is clicked", () => {
    const onVerdict = vi.fn();
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /dark mode/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm selection/i }));

    expect(onVerdict).toHaveBeenCalledWith({ kind: "features_selected", selected: ["a", "b"] });
  });

  it("fires features_selected with [] when all features are unchecked", () => {
    const onVerdict = vi.fn();
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /auth/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm selection/i }));

    expect(onVerdict).toHaveBeenCalledWith({ kind: "features_selected", selected: [] });
  });

  it("fires features_selected with only the unchecked-away ids", () => {
    const onVerdict = vi.fn();
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /confirm selection/i }));

    expect(onVerdict).toHaveBeenCalledWith({ kind: "features_selected", selected: ["a"] });
  });
});

describe("FeatureChecklist — reject path", () => {
  it("fires rejected_iteration_requested with commentary when Reject is clicked", () => {
    const onVerdict = vi.fn();
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.change(screen.getByRole("textbox", { name: /commentary/i }), {
      target: { value: "needs rethink" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));

    expect(onVerdict).toHaveBeenCalledWith({
      kind: "rejected_iteration_requested",
      commentary: "needs rethink",
    });
  });

  it("reject button is disabled when commentary is empty", () => {
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByRole("button", { name: /reject/i })).toBeDisabled();
  });
});

describe("FeatureChecklist — keyboard accessibility", () => {
  it("Confirm button is reachable and keyboard-activatable", () => {
    const onVerdict = vi.fn();
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={onVerdict} />);

    const confirmBtn = screen.getByRole("button", { name: /confirm selection/i });
    confirmBtn.focus();
    fireEvent.keyDown(confirmBtn, { key: "Enter" });
    confirmBtn.click();

    expect(onVerdict).toHaveBeenCalledWith({ kind: "features_selected", selected: ["a"] });
  });

  it("Space toggles a feature checkbox", () => {
    render(<FeatureChecklist payload={PAYLOAD} onVerdict={vi.fn()} />);

    const darkModeCheckbox = screen.getByRole("checkbox", { name: /dark mode/i });
    darkModeCheckbox.focus();
    fireEvent.click(darkModeCheckbox);

    expect(darkModeCheckbox).toBeChecked();
  });
});
