import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { FeatureDetailView } from "./FeatureDetailView";
import type { FeatureDoc } from "./FeatureBrowser";

const TWO_DOCS: FeatureDoc[] = [
  { repo: "consus", file_path: ".pHive/epics/sample-epic/docs/prd.md", content_hash: "abc", last_scanned_at: "2026-07-25T00:00:00Z" },
  { repo: "consus", file_path: ".pHive/epics/sample-epic/docs/architecture.md", content_hash: "def", last_scanned_at: "2026-07-25T00:00:00Z" },
];

/** itemId mirrors server/routes/docs.ts's docItemIdFor(repo, path) exactly
 *  — every real GET /api/docs/content response includes one. */
function itemIdFor(path: string): string {
  return `doc:consus:${path}`;
}

function fetchMockFor(
  content: Record<string, { format: "md" | "html"; content: string }>,
  options: {
    /** itemId -> queued audit-trail entries, returned by GET
     *  /api/items/:id/audit-trail. Defaults to an empty history. */
    auditTrail?: Record<string, unknown[]>;
    /** Handler for POST /api/proposals — defaults to a real-looking
     *  pending-proposal response, mirroring what the server actually
     *  returns (server/routes/proposals.ts: 201 + the inserted row). */
    onPropose?: (body: { itemId: string; targetType: string; diff: string; description: string; requestedBy: string }) => unknown;
  } = {},
) {
  let proposalCounter = 0;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("/api/docs/content")) {
      const params = new URLSearchParams(url.split("?")[1]);
      const path = params.get("path") ?? "";
      const body = content[path];
      if (!body) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
      return Promise.resolve({ ok: true, json: async () => ({ ...body, itemId: itemIdFor(path) }) });
    }

    if (url.startsWith("/api/items/") && url.endsWith("/audit-trail")) {
      const itemId = decodeURIComponent(url.slice("/api/items/".length, url.length - "/audit-trail".length));
      return Promise.resolve({ ok: true, json: async () => options.auditTrail?.[itemId] ?? [] });
    }

    if (url === "/api/proposals" && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      proposalCounter += 1;
      const proposal = options.onPropose
        ? options.onPropose(body)
        : { id: `proposal-${proposalCounter}`, status: "pending", ...body };
      return Promise.resolve({ ok: true, json: async () => proposal });
    }

    return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "unhandled: " + url }) });
  });
}

describe("FeatureDetailView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and renders every doc belonging to the feature together on one screen", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "PRD" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(screen.getByText(".pHive/epics/sample-epic/docs/prd.md")).toBeInTheDocument();
    expect(screen.getByText(".pHive/epics/sample-epic/docs/architecture.md")).toBeInTheDocument();
  });

  it("shows the epic name and doc count in its header", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "sample-epic" })).toBeInTheDocument();
    expect(screen.getByText("2 docs")).toBeInTheDocument();
  });

  it("calls onBack when the back control is clicked", () => {
    vi.stubGlobal("fetch", fetchMockFor({}));
    const onBack = vi.fn();

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: /back to features/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it("wires a real onProposeChange into DocRenderer (s4: request-change) — Edit is available per doc", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    await screen.findByRole("heading", { name: "PRD" });
    // One Edit control per doc (each doc is a single un-headinged section
    // once its own "# <Title>" heading is stripped out as the section's
    // own boundary) — DocRenderer's existing per-section Edit/Fire-to-
    // harness flow, unchanged, now reachable per doc in this view.
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(2);
  });

  it("gives each doc its own 'view diff vs default branch' action when a branch is passed", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} branch="feature/x" />);

    await screen.findByRole("heading", { name: "PRD" });
    expect(screen.getAllByRole("button", { name: "View diff vs default branch" })).toHaveLength(2);
  });

  it("omits the diff action entirely when no branch is passed", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    await screen.findByRole("heading", { name: "PRD" });
    expect(screen.queryByRole("button", { name: "View diff vs default branch" })).not.toBeInTheDocument();
  });

  it("shows a per-doc error when one doc's content fails to load, without blocking the others", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({
        ".pHive/epics/sample-epic/docs/architecture.md": { format: "md", content: "# Architecture" },
      }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={TWO_DOCS} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/could not load .*prd\.md/i)).toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: "Architecture" })).toBeInTheDocument();
  });
});

const ONE_DOC: FeatureDoc[] = [
  { repo: "consus", file_path: ".pHive/epics/sample-epic/docs/prd.md", content_hash: "abc", last_scanned_at: "2026-07-25T00:00:00Z" },
];

/**
 * s4 (consus-phase27-feature-doc-review-ui): the epic's central deliverable
 * — approve/deny/request-change controls per doc, wired to the exact same
 * POST /api/proposals mechanism ArchitectureDiagramView/EventProposeComposer
 * already use (App.tsx's ProjectArchitectureDiagram.proposeChange), targeting
 * the doc's real docItemIdFor item id (returned as `itemId` on every GET
 * /api/docs/content response).
 */
describe("FeatureDetailView — approve/deny/request-change (s4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires a real POST /api/proposals when Approve is clicked, targeting the doc's own item id", async () => {
    const fetchMock = fetchMockFor({
      ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FeatureDetailView epic="sample-epic" docs={ONE_DOC} onBack={vi.fn()} />);
    const section = await screen.findByTestId("feature-doc-.pHive/epics/sample-epic/docs/prd.md");

    fireEvent.click(within(section).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) => call[0] === "/api/proposals" && (call[1] as RequestInit)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });

    const postCall = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/proposals" && (call[1] as RequestInit)?.method === "POST",
    )!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(body).toEqual({
      itemId: "doc:consus:.pHive/epics/sample-epic/docs/prd.md",
      targetType: "doc",
      diff: expect.any(String),
      description: expect.any(String),
      requestedBy: "Mathew",
    });
  });

  it("shows the pending pill after Approve is clicked, via DocRenderer's existing pill UI", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor({ ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" } }),
    );

    render(<FeatureDetailView epic="sample-epic" docs={ONE_DOC} onBack={vi.fn()} />);
    const section = await screen.findByTestId("feature-doc-.pHive/epics/sample-epic/docs/prd.md");

    fireEvent.click(within(section).getByRole("button", { name: /^approve$/i }));

    expect(await within(section).findByText(/change proposed/i)).toBeInTheDocument();
  });

  it("Deny opens a reason composer; submitting fires POST /api/proposals with the operator's text in the description", async () => {
    const fetchMock = fetchMockFor({
      ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FeatureDetailView epic="sample-epic" docs={ONE_DOC} onBack={vi.fn()} />);
    const section = await screen.findByTestId("feature-doc-.pHive/epics/sample-epic/docs/prd.md");

    fireEvent.click(within(section).getByRole("button", { name: /^deny$/i }));
    const composer = section.querySelector(".feature-detail-view__deny-composer") as HTMLElement;
    const denyButton = within(composer).getByRole("button", { name: /^deny$/i });
    expect(denyButton).toBeDisabled();

    fireEvent.change(within(section).getByRole("textbox", { name: /reason/i }), {
      target: { value: "This doc is stale and describes a design we abandoned" },
    });
    expect(denyButton).not.toBeDisabled();
    fireEvent.click(denyButton);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) => call[0] === "/api/proposals" && (call[1] as RequestInit)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });
    const postCall = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/proposals" && (call[1] as RequestInit)?.method === "POST",
    )!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(body.itemId).toBe("doc:consus:.pHive/epics/sample-epic/docs/prd.md");
    expect(body.targetType).toBe("doc");
    expect(body.description).toContain("This doc is stale and describes a design we abandoned");
    expect(body.requestedBy).toBe("Mathew");
  });

  it("Deny's Cancel closes the composer without firing anything", async () => {
    const fetchMock = fetchMockFor({
      ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FeatureDetailView epic="sample-epic" docs={ONE_DOC} onBack={vi.fn()} />);
    const section = await screen.findByTestId("feature-doc-.pHive/epics/sample-epic/docs/prd.md");

    fireEvent.click(within(section).getByRole("button", { name: /^deny$/i }));
    fireEvent.change(within(section).getByRole("textbox", { name: /reason/i }), { target: { value: "nope" } });
    fireEvent.click(within(section).getByRole("button", { name: /^cancel$/i }));

    expect(within(section).queryByRole("textbox", { name: /reason/i })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/proposals")).toBe(false);
  });

  it("request-change (DocRenderer's own Edit -> Fire to harness) fires the same POST /api/proposals shape, with a real computed diff", async () => {
    const fetchMock = fetchMockFor({
      ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD\nsome content" },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FeatureDetailView epic="sample-epic" docs={ONE_DOC} onBack={vi.fn()} />);
    const section = await screen.findByTestId("feature-doc-.pHive/epics/sample-epic/docs/prd.md");

    fireEvent.click(within(section).getByRole("button", { name: /^edit$/i }));
    fireEvent.change(within(section).getByTestId("doc-edit-textarea-0"), {
      target: { value: "# PRD\nsome content\nExtra line" },
    });
    fireEvent.change(within(section).getByPlaceholderText(/removed load balancers/i), {
      target: { value: "add a clarifying line" },
    });
    fireEvent.click(within(section).getByRole("button", { name: /fire to harness/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) => call[0] === "/api/proposals" && (call[1] as RequestInit)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });
    const postCall = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/proposals" && (call[1] as RequestInit)?.method === "POST",
    )!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(body.itemId).toBe("doc:consus:.pHive/epics/sample-epic/docs/prd.md");
    expect(body.targetType).toBe("doc");
    expect(body.diff).toContain("+ Extra line");
    expect(body.description).toBe("add a clarifying line");
    expect(body.requestedBy).toBe("Mathew");
  });

  it("shows the proposal's pending/applied/failed status when the same doc is viewed again, via its audit history", async () => {
    const itemId = "doc:consus:.pHive/epics/sample-epic/docs/prd.md";
    vi.stubGlobal(
      "fetch",
      fetchMockFor(
        { ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" } },
        {
          auditTrail: {
            [itemId]: [
              {
                kind: "proposal",
                id: "proposal-1",
                target_type: "doc",
                description: "Approved",
                status: "pending",
                requested_by: "Mathew",
                timestamp: "2026-08-01T00:00:00Z",
                applied_diff: null,
                failure_reason: null,
              },
            ],
          },
        },
      ),
    );

    render(<FeatureDetailView epic="sample-epic" docs={ONE_DOC} onBack={vi.fn()} />);
    const section = await screen.findByTestId("feature-doc-.pHive/epics/sample-epic/docs/prd.md");

    // A fresh mount — nothing clicked yet — still shows the doc's real,
    // previously-submitted proposal status from its history, not a blank
    // "no history yet" state.
    expect(await within(section).findByText(/proposal · pending/i)).toBeInTheDocument();
  });

  it("shows a failed proposal's history entry with its failure reason after a doc is re-viewed", async () => {
    const itemId = "doc:consus:.pHive/epics/sample-epic/docs/prd.md";
    vi.stubGlobal(
      "fetch",
      fetchMockFor(
        { ".pHive/epics/sample-epic/docs/prd.md": { format: "md", content: "# PRD" } },
        {
          auditTrail: {
            [itemId]: [
              {
                kind: "proposal",
                id: "proposal-1",
                target_type: "doc",
                description: "Denied: stale",
                status: "failed",
                requested_by: "Mathew",
                timestamp: "2026-08-01T00:00:00Z",
                applied_diff: null,
                failure_reason: "TIMEOUT",
              },
            ],
          },
        },
      ),
    );

    render(<FeatureDetailView epic="sample-epic" docs={ONE_DOC} onBack={vi.fn()} />);
    const section = await screen.findByTestId("feature-doc-.pHive/epics/sample-epic/docs/prd.md");

    expect(await within(section).findByText(/proposal · failed/i)).toBeInTheDocument();
    expect(within(section).getByText(/TIMEOUT/)).toBeInTheDocument();
  });
});
