import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EpicDocsPanel } from "./EpicDocsPanel";

describe("EpicDocsPanel", () => {
  it("renders design discussion, research brief, and outline accordions", () => {
    render(
      <EpicDocsPanel
        docs={[
          { kind: "design-discussion", title: "Design Discussion", content: "Design notes" },
          { kind: "research-brief", title: "Research Brief", content: "Research notes" },
          { kind: "outline", title: "Outline", content: "Outline notes" },
        ]}
      />,
    );

    expect(screen.getByTestId("epic-doc-design-discussion")).toHaveTextContent("Design Discussion");
    expect(screen.getByTestId("epic-doc-research-brief")).toHaveTextContent("Research Brief");
    expect(screen.getByTestId("epic-doc-outline")).toHaveTextContent("Outline");
  });
});
