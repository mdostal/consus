import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConceptSelection } from "./ConceptSelection";
import type { ConceptSelectionPayload } from "./types";

const PAYLOAD: ConceptSelectionPayload = {
  version: "dostal:concept-selection/v1",
  title: "Pick a logo concept",
  context: "Three directions from the brand explorer.",
  concepts: [
    {
      id: "geo",
      name: "Geometric",
      description: "Sharp angular mark.",
      preview: { kind: "svg", markup: "<svg data-testid=\"svg-geo\"><rect width=\"10\" height=\"10\"/></svg>" },
    },
    {
      id: "script",
      name: "Script",
      description: "Flowing wordmark.",
      preview: { kind: "svg", markup: "<svg data-testid=\"svg-script\"><path d=\"M0 0\"/></svg>" },
    },
  ],
};

describe("ConceptSelection", () => {
  it("renders every concept's name, description, and SVG preview", () => {
    render(<ConceptSelection payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByText("Geometric")).toBeInTheDocument();
    expect(screen.getByText("Sharp angular mark.")).toBeInTheDocument();
    expect(screen.getByText("Script")).toBeInTheDocument();
    expect(screen.getByText("Flowing wordmark.")).toBeInTheDocument();

    expect(screen.getByTestId("concept-preview-geo").querySelector("svg")).toBeInTheDocument();
    expect(screen.getByTestId("concept-preview-script").querySelector("svg")).toBeInTheDocument();
  });

  it("clicking Select on a concept fires a concept_selected verdict with that concept's id", () => {
    const onVerdict = vi.fn();
    render(<ConceptSelection payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /select script/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "concept_selected", conceptId: "script" });
  });

  it("selecting one concept does not fire a verdict for the other", () => {
    const onVerdict = vi.fn();
    render(<ConceptSelection payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /select geometric/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "concept_selected", conceptId: "geo" });
    expect(onVerdict).not.toHaveBeenCalledWith({ kind: "concept_selected", conceptId: "script" });
  });
});
