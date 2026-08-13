import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { App } from "./App";

const KB_ENTRY = { id: "kb-1", title: "Architecture note", source_repo: "consus", created_at: "2026-08-01T00:00:00Z" };

const DIAGRAM_RESPONSE = { itemId: "diagram:consus", epics: [] };

const DOCS_EMPTY = {};
const DOCS_WITH_ENTRY = {
  consus: { planning: [{ epic: null, file_path: "architecture.md", content_hash: "abc", last_scanned_at: "2026-08-01T00:00:00Z" }] },
};

function mockFetchImpl(responses: Record<string, unknown>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;

    for (const [pattern, body] of Object.entries(responses)) {
      if (key.startsWith(pattern) || url.startsWith(pattern)) {
        if (body instanceof Error) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: body.message }) });
        }
        return Promise.resolve({ ok: true, json: async () => body });
      }
    }
    return Promise.resolve({ ok: true, json: async () => [] });
  });
}

async function openConsusProject() {
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "consus" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "consus" }));
}

describe("App — per-project view folds in docs + an Ingest repo action (phase6 s2)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      mockFetchImpl({
        "/api/decisions": [],
        "/api/kb-entries": [KB_ENTRY],
        "/api/diagrams": DIAGRAM_RESPONSE,
        "/api/items/": [],
        "GET /api/docs?project=consus": DOCS_WITH_ENTRY,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the diagram cascade, KB entries, and docs together for a selected project", async () => {
    render(<App />);
    await openConsusProject();

    expect(await screen.findByText("Architecture note")).toBeInTheDocument();
    expect(await screen.findByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ingest repo/i })).toBeInTheDocument();
  });

  it("shows an enabled Ingest repo button when the project has no docs yet", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchImpl({
        "/api/decisions": [],
        "/api/kb-entries": [KB_ENTRY],
        "/api/diagrams": DIAGRAM_RESPONSE,
        "/api/items/": [],
        "GET /api/docs?project=consus": DOCS_EMPTY,
      }),
    );

    render(<App />);
    await openConsusProject();

    expect(await screen.findByText("No docs indexed yet")).toBeInTheDocument();
    const ingestButton = screen.getByRole("button", { name: /ingest repo/i });
    expect(ingestButton).toBeInTheDocument();
    expect(ingestButton).toBeEnabled();
  });

  it("reloads the docs list after a successful ingest, without a full page refresh", async () => {
    let docsCallCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "POST" && url.startsWith("/api/projects/consus/ingest")) {
        return Promise.resolve({ ok: true, json: async () => ({ project: "consus", docsScanned: 1 }) });
      }
      if (url.startsWith("/api/docs?project=consus")) {
        docsCallCount += 1;
        return Promise.resolve({ ok: true, json: async () => (docsCallCount === 1 ? DOCS_EMPTY : DOCS_WITH_ENTRY) });
      }
      if (url.startsWith("/api/decisions")) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.startsWith("/api/kb-entries")) return Promise.resolve({ ok: true, json: async () => [KB_ENTRY] });
      if (url.startsWith("/api/diagrams")) return Promise.resolve({ ok: true, json: async () => DIAGRAM_RESPONSE });
      if (url.startsWith("/api/items/")) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();

    expect(await screen.findByText("No docs indexed yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ingest repo/i }));

    expect(await screen.findByText("architecture.md")).toBeInTheDocument();
    expect(screen.queryByText("No docs indexed yet")).not.toBeInTheDocument();
  });

  it("shows a visible error when the ingest request fails, rather than failing silently", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "POST" && url.startsWith("/api/projects/consus/ingest")) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "scan failed" }) });
      }
      if (url.startsWith("/api/docs?project=consus")) return Promise.resolve({ ok: true, json: async () => DOCS_EMPTY });
      if (url.startsWith("/api/decisions")) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.startsWith("/api/kb-entries")) return Promise.resolve({ ok: true, json: async () => [KB_ENTRY] });
      if (url.startsWith("/api/diagrams")) return Promise.resolve({ ok: true, json: async () => DIAGRAM_RESPONSE });
      if (url.startsWith("/api/items/")) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();
    await screen.findByText("No docs indexed yet");

    fireEvent.click(screen.getByRole("button", { name: /ingest repo/i }));

    expect(await screen.findByText("scan failed")).toBeInTheDocument();
  });
});
