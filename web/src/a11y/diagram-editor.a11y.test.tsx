import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "./axe";
import { MermaidEditor } from "../features/diagrams/MermaidEditor";
import { MmdDiagramView } from "../features/diagrams/MmdDiagramView";
import { NewDocForm } from "../features/diagrams/NewDocForm";
import { DocRenderer } from "../features/docs/DocRenderer";

vi.mock("../features/diagrams/mermaidRender", async () => {
  const { fakeRenderMermaid } = await import("../features/diagrams/testMermaidRender");
  return { renderMermaid: fakeRenderMermaid };
});

/** PANT-965: axe coverage for the diagram editor, the .mmd view, the
 *  new-doc form, and a doc with a rendered (and a broken) mermaid fence. */
describe("diagram surfaces a11y (PANT-965)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("MermaidEditor has no axe violations", async () => {
    const { container } = render(<MermaidEditor initialSource="flowchart LR" onSave={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByTestId("mermaid-svg");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("MmdDiagramView has no axe violations", async () => {
    const { container } = render(<MmdDiagramView path="docs/a.mmd" content="flowchart LR" onProposeChange={vi.fn()} />);
    await screen.findByTestId("mermaid-svg");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a doc with a working and a broken mermaid fence has no axe violations", async () => {
    const { container } = render(
      <DocRenderer
        format="md"
        content={"# Doc\n\n```mermaid\nflowchart LR\n```\n\n```mermaid\nINVALID\n```\n"}
        onProposeChange={vi.fn()}
      />,
    );
    await screen.findByRole("alert");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("NewDocForm has no axe violations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            templates: [{ id: "mmd-flowchart", label: "Flowchart", kind: "diagram", extension: ".mmd", content: "flowchart TD" }],
          }),
        }),
      ),
    );
    const { container } = render(<NewDocForm repo="consus" kind="diagram" onCreated={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("New file content")).toHaveValue("flowchart TD"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
