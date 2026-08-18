import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SkinBackdrop } from "./SkinBackdrop";

describe("SkinBackdrop", () => {
  it("renders Drafting Table's registration-tick decoration when skin is 'drafting'", () => {
    const { container } = render(<SkinBackdrop skin="drafting" />);
    expect(container.querySelector('[data-testid="drafting-registration-marks"]')).toBeInTheDocument();
  });

  it("renders Case Board's cork-texture decoration when skin is 'case-board'", () => {
    const { container } = render(<SkinBackdrop skin="case-board" />);
    expect(container.querySelector('[data-testid="case-board-cork-texture"]')).toBeInTheDocument();
  });

  it("renders no full-page backdrop for 'harness' (its decoration is inline chrome, not a backdrop)", () => {
    const { container } = render(<SkinBackdrop skin="harness" />);
    expect(container.querySelector('[data-testid="drafting-registration-marks"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="case-board-cork-texture"]')).not.toBeInTheDocument();
  });

  it("every backdrop is decorative-only: aria-hidden and inert to pointer events", () => {
    const { container: draftingContainer } = render(<SkinBackdrop skin="drafting" />);
    const drafting = draftingContainer.querySelector('[data-testid="drafting-registration-marks"]');
    expect(drafting).toHaveAttribute("aria-hidden", "true");

    const { container: caseBoardContainer } = render(<SkinBackdrop skin="case-board" />);
    const caseBoard = caseBoardContainer.querySelector('[data-testid="case-board-cork-texture"]');
    expect(caseBoard).toHaveAttribute("aria-hidden", "true");
  });
});
