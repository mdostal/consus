import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NewDocForm, withExtension } from "./NewDocForm";

vi.mock("./mermaidRender", async () => {
  const { fakeRenderMermaid } = await import("./testMermaidRender");
  return { renderMermaid: fakeRenderMermaid };
});

const TEMPLATES = [
  { id: "blank", label: "Blank doc", kind: "doc", extension: ".md", content: "# Title\n" },
  { id: "adr", label: "ADR", kind: "doc", extension: ".md", content: "# ADR: Title\n" },
  { id: "mmd-flowchart", label: "Flowchart diagram (.mmd)", kind: "diagram", extension: ".mmd", content: "flowchart TD\n  a --> b\n" },
  { id: "mmd-sequence", label: "Sequence diagram (.mmd)", kind: "diagram", extension: ".mmd", content: "sequenceDiagram\n" },
];

describe("NewDocForm (PANT-965)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let newResponse: { status: number; body: unknown };

  beforeEach(() => {
    newResponse = {
      status: 201,
      body: { repo: "consus", path: "docs/diagrams/login.mmd", itemId: "doc:consus:docs/diagrams/login.mmd", proposal: { id: "p1", status: "pending" } },
    };
    fetchMock = vi.fn((url: string) => {
      if (url === "/api/docs/templates") return Promise.resolve({ ok: true, json: async () => ({ templates: TEMPLATES }) });
      if (url === "/api/docs/new") {
        return Promise.resolve({ ok: newResponse.status < 400, status: newResponse.status, json: async () => newResponse.body });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers only the templates for its kind and seeds the content", async () => {
    render(<NewDocForm repo="consus" kind="diagram" onCreated={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("New file content")).toHaveValue("flowchart TD\n  a --> b\n"));
    const options = within(screen.getByLabelText("Template")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Flowchart diagram (.mmd)", "Sequence diagram (.mmd)"]);

    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "mmd-sequence" } });
    expect(screen.getByLabelText("New file content")).toHaveValue("sequenceDiagram\n");
  });

  it("previews a new diagram live", async () => {
    render(<NewDocForm repo="consus" kind="diagram" onCreated={vi.fn()} onCancel={vi.fn()} />);
    const preview = screen.getByTestId("new-doc-preview");
    await waitFor(() => expect(within(preview).getByTestId("mermaid-svg")).toHaveTextContent("a --> b"));
  });

  it("posts a new-file proposal with the path, template, and edited content", async () => {
    const onCreated = vi.fn();
    render(<NewDocForm repo="consus" kind="diagram" onCreated={onCreated} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("New file content")).toHaveValue("flowchart TD\n  a --> b\n"));

    fireEvent.change(screen.getByLabelText("File path"), { target: { value: "docs/diagrams/login" } });
    fireEvent.change(screen.getByLabelText("New file content"), { target: { value: "flowchart TD\n  login --> home\n" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "login flow" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose new file" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(newResponse.body));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/docs/new")!;
    expect(JSON.parse(init.body)).toEqual({
      repo: "consus",
      path: "docs/diagrams/login.mmd",
      template: "mmd-flowchart",
      content: "flowchart TD\n  login --> home\n",
      description: "login flow",
      requestedBy: "Mathew",
    });
  });

  it("shows the server's error, e.g. when the file already exists", async () => {
    newResponse = { status: 409, body: { error: "file already exists: README.md" } };
    const onCreated = vi.fn();
    render(<NewDocForm repo="consus" kind="doc" onCreated={onCreated} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("New file content")).toHaveValue("# Title\n"));

    fireEvent.click(screen.getByRole("button", { name: "Propose new file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("file already exists: README.md");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("appends the template extension only when the path has none", () => {
    expect(withExtension("docs/adr/0001", ".md")).toBe("docs/adr/0001.md");
    expect(withExtension("docs/adr/0001.md", ".md")).toBe("docs/adr/0001.md");
    expect(withExtension("docs/v1.2/flow.mmd", ".mmd")).toBe("docs/v1.2/flow.mmd");
  });
});
