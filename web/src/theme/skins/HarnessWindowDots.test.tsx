import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HarnessWindowDots } from "./HarnessWindowDots";

describe("HarnessWindowDots", () => {
  it("renders three terminal-window-style dots, decorative only", () => {
    const { container } = render(<HarnessWindowDots />);
    const root = container.querySelector('[data-testid="harness-window-dots"]');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root!.querySelectorAll(".harness-window-dots__dot")).toHaveLength(3);
  });
});
