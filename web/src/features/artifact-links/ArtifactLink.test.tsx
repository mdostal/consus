import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArtifactLink } from "./ArtifactLink";

describe("ArtifactLink", () => {
  it("renders a link reachable in one click, without re-rendering the Artifact's content", () => {
    render(<ArtifactLink url="https://claude.ai/code/artifact/abc-123" label="CBA" />);

    const link = screen.getByRole("link", { name: /CBA/i });
    expect(link).toHaveAttribute("href", "https://claude.ai/code/artifact/abc-123");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("falls back to the URL as the label when no label is given", () => {
    render(<ArtifactLink url="https://claude.ai/code/artifact/abc-123" />);
    expect(screen.getByRole("link", { name: /claude\.ai/i })).toBeInTheDocument();
  });
});
