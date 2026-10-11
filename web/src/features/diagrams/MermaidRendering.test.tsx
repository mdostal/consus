import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DocRenderer } from "../docs/DocRenderer";
import { computeLineDiff } from "../docs/textDiff";
import { MermaidEditor } from "./MermaidEditor";
import { MmdDiagramView } from "./MmdDiagramView";

vi.mock("./mermaidRender", async () => {
  const { fakeRenderMermaid } = await import("./testMermaidRender");
  return { renderMermaid: fakeRenderMermaid };
});

const DOC = ["# Architecture", "", "```mermaid", "flowchart LR", "  api --> db", "```", "", "After the diagram."].join("\n");

describe("mermaid fences in the doc view (PANT-965)", () => {
  it("renders a mermaid fence as a diagram, not a code block", async () => {
    render(<DocRenderer format="md" content={DOC} />);

    const block = await screen.findByTestId("doc-mermaid-0");
    expect(await within(block).findByTestId("mermaid-svg")).toHaveTextContent("flowchart LR api --> db");
    expect(screen.getByTestId("doc-html").querySelector("pre code")).toBeNull();
    expect(screen.getByText("After the diagram.")).toBeInTheDocument();
  });

  it("shows the syntax error for a broken diagram instead of a blank", async () => {
    render(<DocRenderer format="md" content={"```mermaid\nINVALID diagram\n```\n"} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Mermaid syntax error");
    expect(alert).toHaveTextContent("Parse error on line 1");
    expect(alert).toHaveTextContent("INVALID diagram");
  });

  it("leaves other fenced code blocks as code", async () => {
    render(<DocRenderer format="md" content={"```ts\nconst x = 1;\n```\n"} />);
    expect(screen.getByTestId("doc-html").querySelector("pre code")).toHaveTextContent("const x = 1;");
    expect(screen.queryByTestId("doc-mermaid-0")).toBeNull();
  });

  it("has no Edit diagram button when the view is read-only", async () => {
    render(<DocRenderer format="md" content={DOC} />);
    await screen.findByTestId("mermaid-svg");
    expect(screen.queryByRole("button", { name: /edit diagram/i })).toBeNull();
  });

  it("edits a mermaid block in place and fires a whole-doc proposal", async () => {
    const onProposeChange = vi.fn();
    render(<DocRenderer format="md" content={DOC} onProposeChange={onProposeChange} />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit diagram 1" }));
    const source = screen.getByLabelText("Diagram source");
    expect(source).toHaveValue("flowchart LR\n  api --> db");

    fireEvent.change(source, { target: { value: "flowchart LR\n  api --> cache\n  cache --> db" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "add cache" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as proposal" }));

    const expectedDoc = DOC.replace("  api --> db", "  api --> cache\n  cache --> db");
    expect(onProposeChange).toHaveBeenCalledWith({ diff: computeLineDiff(DOC, expectedDoc), description: "add cache" });
    // Back to the rendered doc.
    expect(screen.queryByTestId("mermaid-editor")).toBeNull();
    expect(await screen.findByTestId("doc-mermaid-0")).toBeInTheDocument();
  });
});

describe("MermaidEditor", () => {
  it("re-renders the preview from the edited source", async () => {
    render(<MermaidEditor initialSource={"flowchart LR\n  a --> b"} previewDelayMs={0} onSave={vi.fn()} onCancel={vi.fn()} />);
    const preview = screen.getByTestId("mermaid-editor-preview");
    expect(await within(preview).findByTestId("mermaid-svg")).toHaveTextContent("a --> b");

    fireEvent.change(screen.getByLabelText("Diagram source"), { target: { value: "flowchart LR\n  a --> c" } });
    expect(await within(preview).findByText(/a --> c/)).toBeInTheDocument();
  });

  it("shows a syntax error in the preview while the source stays editable", async () => {
    render(<MermaidEditor initialSource="flowchart LR" previewDelayMs={0} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Diagram source"), { target: { value: "INVALID" } });

    expect(await within(screen.getByTestId("mermaid-editor-preview")).findByRole("alert")).toHaveTextContent("Parse error");
    expect(screen.getByLabelText("Diagram source")).not.toBeDisabled();
  });

  it("only enables saving once the source changed and a description is given", () => {
    const onSave = vi.fn();
    render(<MermaidEditor initialSource="flowchart LR" onSave={onSave} onCancel={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Save as proposal" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Diagram source"), { target: { value: "flowchart TD" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  vertical  " } });
    expect(save).toBeEnabled();

    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({ source: "flowchart TD", description: "vertical" });
  });
});

describe("MmdDiagramView", () => {
  const MMD = "sequenceDiagram\n  Client->>Server: Request\n";

  it("renders the .mmd file as a diagram", async () => {
    render(<MmdDiagramView path="docs/login.mmd" content={MMD} />);
    expect(await screen.findByTestId("mermaid-svg")).toHaveTextContent("Client->>Server: Request");
    expect(screen.queryByRole("button", { name: "Edit diagram" })).toBeNull();
  });

  it("saves an edit as a proposal with a line diff of the file", async () => {
    const onProposeChange = vi.fn();
    render(<MmdDiagramView path="docs/login.mmd" content={MMD} onProposeChange={onProposeChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit diagram" }));
    const next = "sequenceDiagram\n  Client->>Server: Request\n  Server-->>Client: Response\n";
    fireEvent.change(screen.getByLabelText("Diagram source"), { target: { value: next } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "add response" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as proposal" }));

    expect(onProposeChange).toHaveBeenCalledWith({ diff: computeLineDiff(MMD, next), description: "add response" });
    expect(screen.queryByTestId("mermaid-editor")).toBeNull();
  });

  it("shows the pending pill once a proposal is in flight", () => {
    render(<MmdDiagramView path="docs/login.mmd" content={MMD} onProposeChange={vi.fn()} pendingProposal />);
    expect(screen.getByText("change proposed…")).toBeInTheDocument();
  });
});
