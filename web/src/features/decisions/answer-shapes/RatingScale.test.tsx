import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RatingScale } from "./RatingScale";
import type { RatingPayload } from "./types";

const PAYLOAD: RatingPayload = {
  version: "dostal:rating/v1",
  title: "How did the migration go?",
  context: "Rate the cutover.",
  prompt: "Rate the migration from 1-5",
  scale: { min: 1, max: 5, labels: { 1: "Poor", 5: "Excellent" } },
};

describe("RatingScale", () => {
  it("renders one button per value in the min-max range, using labels where given", () => {
    render(<RatingScale payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Poor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excellent" })).toBeInTheDocument();
  });

  it("disables submit until a value is picked", () => {
    render(<RatingScale payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByRole("button", { name: /submit rating/i })).toBeDisabled();
  });

  it("picking a value marks it pressed and submitting fires a 'rated' verdict", () => {
    const onVerdict = vi.fn();
    render(<RatingScale payload={PAYLOAD} onVerdict={onVerdict} />);

    const fourButton = screen.getByRole("button", { name: "4" });
    fireEvent.click(fourButton);
    expect(fourButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /submit rating/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "rated", value: 4 });
  });

  it("respects a scale without labels by rendering bare numbers", () => {
    const unlabeledPayload: RatingPayload = {
      ...PAYLOAD,
      scale: { min: 1, max: 3 },
    };
    render(<RatingScale payload={unlabeledPayload} onVerdict={vi.fn()} />);

    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument();
  });
});
