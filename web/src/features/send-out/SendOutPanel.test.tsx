import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SendOutPanel, exportUrl, sendOutItemId } from "./SendOutPanel";

function res(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

function buildFetchMock() {
  let artifactUrl: string | null = null;
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });

    if (url.startsWith("/api/export/")) return res(200, `exported ${url}`);
    if (url.endsWith("/claude-artifact")) {
      if (method === "PUT") artifactUrl = body.url;
      return res(200, { itemId: "x", url: artifactUrl });
    }
    if (url.endsWith("/import")) return res(201, { id: "p1", status: "pending", failure_reason: null });
    return res(404, { error: "not found" });
  });
  return { fn, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SendOutPanel helpers", () => {
  it("builds item ids and export URLs for docs and diagrams", () => {
    const doc = { type: "doc" as const, repo: "consus", path: "docs/a b.md" };
    expect(sendOutItemId(doc)).toBe("doc:consus:docs/a b.md");
    expect(exportUrl(doc, "html")).toBe("/api/export/doc?repo=consus&path=docs%2Fa%20b.md&format=html");
    const diagram = { type: "diagram" as const, repo: "consus", kinds: ["architecture" as const] };
    expect(sendOutItemId(diagram)).toBe("diagram:consus");
    expect(exportUrl(diagram, "svg")).toBe("/api/export/diagram?repo=consus&kind=architecture&format=svg");
  });
});

describe("SendOutPanel", () => {
  it("offers .md and HTML downloads for a doc", () => {
    vi.stubGlobal("fetch", buildFetchMock().fn);
    render(<SendOutPanel target={{ type: "doc", repo: "r", path: "docs/x.md" }} />);
    expect(screen.getByText("Download .md").getAttribute("href")).toBe("/api/export/doc?repo=r&path=docs%2Fx.md&format=md");
    expect(screen.getByText("Download HTML").getAttribute("href")).toBe(
      "/api/export/doc?repo=r&path=docs%2Fx.md&format=html",
    );
    expect(screen.queryByText("Download SVG")).toBeNull();
  });

  it("offers .mmd/SVG/.md/HTML for a diagram and follows the selected kind", () => {
    vi.stubGlobal("fetch", buildFetchMock().fn);
    render(<SendOutPanel target={{ type: "diagram", repo: "r", kinds: ["architecture", "architecture-full"] }} />);
    expect(screen.getByText("Download SVG").getAttribute("href")).toBe("/api/export/diagram?repo=r&kind=architecture&format=svg");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "architecture-full" } });
    expect(screen.getByText("Download .mmd").getAttribute("href")).toBe(
      "/api/export/diagram?repo=r&kind=architecture-full&format=mmd",
    );
  });

  it("Open in Claude copies the server's prompt to the clipboard", async () => {
    const { fn } = buildFetchMock();
    vi.stubGlobal("fetch", fn);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<SendOutPanel target={{ type: "doc", repo: "r", path: "docs/x.md" }} />);

    fireEvent.click(screen.getByText("Open in Claude"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("exported /api/export/doc?repo=r&path=docs%2Fx.md&format=claude-prompt"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Claude prompt copied");

    fireEvent.click(screen.getByText("Copy as markdown"));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("exported /api/export/doc?repo=r&path=docs%2Fx.md&format=md"));
  });

  it("falls back to a manual-copy box when the clipboard is unavailable", async () => {
    vi.stubGlobal("fetch", buildFetchMock().fn);
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<SendOutPanel target={{ type: "doc", repo: "r", path: "docs/x.md" }} />);
    fireEvent.click(screen.getByText("Open in Claude"));
    expect(await screen.findByLabelText("Text to copy")).toHaveValue(
      "exported /api/export/doc?repo=r&path=docs%2Fx.md&format=claude-prompt",
    );
  });

  it("saves the published artifact URL and shows it as a link", async () => {
    const { fn, calls } = buildFetchMock();
    vi.stubGlobal("fetch", fn);
    render(<SendOutPanel target={{ type: "doc", repo: "r", path: "docs/x.md" }} />);

    fireEvent.change(screen.getByLabelText("Published Claude artifact URL"), {
      target: { value: "https://claude.ai/artifact/abc" },
    });
    fireEvent.click(screen.getByText("Save artifact URL"));

    const link = await screen.findByTestId("send-out-artifact-link");
    expect(link).toHaveAttribute("href", "https://claude.ai/artifact/abc");
    expect(calls.find((c) => c.method === "PUT")).toMatchObject({
      url: "/api/items/doc%3Ar%3Adocs%2Fx.md/claude-artifact",
      body: { url: "https://claude.ai/artifact/abc", actor: "Mathew" },
    });
  });

  it("imports pasted content as a proposal and notifies the host", async () => {
    const { fn, calls } = buildFetchMock();
    vi.stubGlobal("fetch", fn);
    const onProposalCreated = vi.fn();
    render(
      <SendOutPanel
        target={{ type: "diagram", repo: "r", kinds: ["cascade"] }}
        onProposalCreated={onProposalCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText("Paste the final content"), { target: { value: "graph LR\n  a --> b" } });
    fireEvent.change(screen.getByLabelText("Import description"), { target: { value: "add edge" } });
    fireEvent.click(screen.getByText("Propose change"));

    expect(await screen.findByRole("status")).toHaveTextContent("Proposal created");
    expect(onProposalCreated).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/items/diagram%3Ar/import",
      body: { content: "graph LR\n  a --> b", description: "add edge", requestedBy: "Mathew", kind: "cascade" },
    });
  });

  it("imports an uploaded file with its filename", async () => {
    const { fn, calls } = buildFetchMock();
    vi.stubGlobal("fetch", fn);
    render(<SendOutPanel target={{ type: "doc", repo: "r", path: "docs/x.md" }} />);

    const file = new File(["# Final\n"], "final.md", { type: "text/markdown" });
    // jsdom's File has no text(); every browser Consus targets does.
    Object.defineProperty(file, "text", { value: async () => "# Final\n" });
    fireEvent.change(screen.getByLabelText("Upload the final file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText("Paste the final content")).toHaveValue("# Final\n"));
    fireEvent.click(screen.getByText("Propose change"));

    await screen.findByRole("status");
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ content: "# Final\n", filename: "final.md" });
  });
});
