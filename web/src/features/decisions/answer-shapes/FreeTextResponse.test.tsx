import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FreeTextResponse } from "./FreeTextResponse";
import type { FreeTextPayload } from "./types";

const PAYLOAD: FreeTextPayload = {
  version: "dostal:free-text/v1",
  title: "Anything else we should know?",
  context: "We're wrapping up the retro.",
  prompt: "Share any additional feedback",
};

describe("FreeTextResponse", () => {
  it("renders the context and prompt", () => {
    render(<FreeTextResponse payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByText("We're wrapping up the retro.")).toBeInTheDocument();
    expect(screen.getByText("Share any additional feedback")).toBeInTheDocument();
  });

  it("disables submit until text is entered", () => {
    render(<FreeTextResponse payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
  });

  it("submitting fires a 'text_response' verdict with the entered text", () => {
    const onVerdict = vi.fn();
    render(<FreeTextResponse payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.change(screen.getByRole("textbox", { name: /share any additional feedback/i }), {
      target: { value: "The retro format worked well this time." },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(onVerdict).toHaveBeenCalledWith({
      kind: "text_response",
      text: "The retro format worked well this time.",
    });
  });
});
