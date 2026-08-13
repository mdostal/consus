import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { App } from "./App";

const KB_ENTRY = { id: "kb-1", title: "Architecture note", source_repo: "consus", created_at: "2026-08-01T00:00:00Z" };

const DIAGRAM_RESPONSE = { itemId: "diagram:consus", epics: [] };

// GET /api/docs always includes an entry for every registered repo, even
// with zero docs indexed — matches the real server response shape.
const DOCS_EMPTY = { consus: {} };
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
  fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
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
        "GET /api/projects": { projects: ["consus"] },
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
        "GET /api/projects": { projects: ["consus"] },
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
      if (url.startsWith("/api/projects")) return Promise.resolve({ ok: true, json: async () => ({ projects: ["consus"] }) });
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
      if (url.startsWith("/api/projects")) return Promise.resolve({ ok: true, json: async () => ({ projects: ["consus"] }) });
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

  it("a registered project is selectable and shows its docs/diagram even with zero KB entries anywhere", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchImpl({
        "/api/decisions": [],
        "/api/kb-entries": [],
        "/api/diagrams": DIAGRAM_RESPONSE,
        "/api/items/": [],
        "GET /api/docs?project=consus": DOCS_WITH_ENTRY,
        "GET /api/docs": DOCS_WITH_ENTRY,
        "GET /api/projects": { projects: ["consus"] },
      }),
    );

    render(<App />);
    await openConsusProject();

    expect(await screen.findByText("architecture.md")).toBeInTheDocument();
  });
});

function firstRunFetchMock(overrides: {
  decisions?: unknown[];
  docs?: unknown;
  kbEntries?: unknown[];
  ingestOk?: boolean;
  docsAfterIngest?: unknown;
}) {
  const decisions = overrides.decisions ?? [];
  const docs = overrides.docs ?? DOCS_EMPTY;
  const kbEntries = overrides.kbEntries ?? [];
  let docsCallCount = 0;

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (method === "POST" && url.startsWith("/api/projects/consus/ingest")) {
      if (overrides.ingestOk === false) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "scan failed" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ project: "consus", docsScanned: 1 }) });
    }
    if (url.startsWith("/api/projects")) return Promise.resolve({ ok: true, json: async () => ({ projects: ["consus"] }) });
    if (url.startsWith("/api/docs")) {
      docsCallCount += 1;
      const body = docsCallCount === 1 ? docs : (overrides.docsAfterIngest ?? DOCS_WITH_ENTRY);
      return Promise.resolve({ ok: true, json: async () => body });
    }
    if (url.startsWith("/api/decisions")) return Promise.resolve({ ok: true, json: async () => decisions });
    if (url.startsWith("/api/kb-entries")) return Promise.resolve({ ok: true, json: async () => kbEntries });
    if (url.startsWith("/api/diagrams")) return Promise.resolve({ ok: true, json: async () => DIAGRAM_RESPONSE });
    if (url.startsWith("/api/items/")) return Promise.resolve({ ok: true, json: async () => [] });
    return Promise.resolve({ ok: true, json: async () => [] });
  });
}

describe("App — first-run onboarding screen (phase6 s3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the onboarding screen instead of the normal tab shell on a totally fresh install", async () => {
    vi.stubGlobal("fetch", firstRunFetchMock({ decisions: [], docs: DOCS_EMPTY, kbEntries: [] }));

    render(<App />);

    expect(await screen.findByText("Ingest repo to create initial knowledge base")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decisions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing waiting on you")).not.toBeInTheDocument();
  });

  it("transitions into the normal tab shell after a successful ingest, without a manual page reload", async () => {
    vi.stubGlobal(
      "fetch",
      firstRunFetchMock({ decisions: [], docs: DOCS_EMPTY, kbEntries: [], docsAfterIngest: DOCS_WITH_ENTRY }),
    );

    render(<App />);
    await screen.findByText("Ingest repo to create initial knowledge base");

    fireEvent.click(screen.getByRole("button", { name: "Ingest repo to create initial knowledge base" }));

    expect(await screen.findByRole("button", { name: "Decisions" })).toBeInTheDocument();
    expect(screen.queryByText("Ingest repo to create initial knowledge base")).not.toBeInTheDocument();
  });

  it("shows the normal tab shell directly when any of docs, KB entries, or decisions already exist", async () => {
    vi.stubGlobal(
      "fetch",
      firstRunFetchMock({
        decisions: [{ id: "item-1", type: "doc_ref", title: "q", status: "open", source_repo: null, decided_at: null, decision_payload: null }],
        docs: DOCS_EMPTY,
        kbEntries: [],
      }),
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: /^Decisions/ })).toBeInTheDocument();
    expect(screen.queryByText("Ingest repo to create initial knowledge base")).not.toBeInTheDocument();
  });

  it("shows the install-into-harness pointer and the plugin-hive copy alongside the ingest action", async () => {
    vi.stubGlobal("fetch", firstRunFetchMock({ decisions: [], docs: DOCS_EMPTY, kbEntries: [] }));

    render(<App />);

    expect(await screen.findByText("Install into harness")).toBeInTheDocument();
    expect(screen.getByText(/skills\/consus\/SKILL\.md/)).toBeInTheDocument();
    expect(screen.getByText("Interact with plugin-hive")).toBeInTheDocument();
  });
});
