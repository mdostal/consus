import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { App } from "./App";

/** s4 (consus-phase24-branch-level-surfacing): a configurable fetch mock for
 *  the branch-picker + branch-scoped-decisions + doc-diff wiring, kept
 *  separate from mockFetchImpl above since these tests need to assert on
 *  the *exact* set of calls fired (regression AC1), not just stub bodies. */
function branchFetchMock(
  opts: {
    branches?: string[];
    branchDecisions?: unknown[];
    docDiff?: { diff: string | null } | "error";
    ingestOk?: boolean;
  } = {},
) {
  const branches = opts.branches ?? ["feature/x"];
  const branchDecisions = opts.branchDecisions ?? [];
  const calls: string[] = [];

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);

    if (method === "POST" && url.startsWith("/api/projects/consus/ingest?ref=")) {
      if (opts.ingestOk === false) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "ingest failed" }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ project: "consus", ref: "feature/x", docsScanned: 1, decisionsFound: branchDecisions.length }),
      });
    }
    if (method === "POST" && url.startsWith("/api/projects/consus/ingest")) {
      return Promise.resolve({ ok: true, json: async () => ({ project: "consus", docsScanned: 1, eventsCreated: 0 }) });
    }
    if (url.startsWith("/api/projects/consus/branches")) {
      return Promise.resolve({ ok: true, json: async () => ({ branches }) });
    }
    if (url.startsWith("/api/projects")) return Promise.resolve({ ok: true, json: async () => ({ projects: ["consus"] }) });
    if (url.includes("/api/decisions?all=1&branch=")) {
      return Promise.resolve({ ok: true, json: async () => branchDecisions });
    }
    if (url.startsWith("/api/decisions")) return Promise.resolve({ ok: true, json: async () => [] });
    if (url.startsWith("/api/kb-entries")) return Promise.resolve({ ok: true, json: async () => [KB_ENTRY] });
    if (url.startsWith("/api/diagrams")) return Promise.resolve({ ok: true, json: async () => DIAGRAM_RESPONSE });
    if (url.startsWith("/api/items/")) return Promise.resolve({ ok: true, json: async () => [] });
    if (url.startsWith("/api/docs/diff")) {
      if (opts.docDiff === "error") {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: "bad ref" }) });
      }
      return Promise.resolve({ ok: true, json: async () => (opts.docDiff ?? { diff: "- old line\n+ new line" }) });
    }
    if (url.startsWith("/api/docs/content")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ format: "md", content: "# doc", itemId: "doc:consus:architecture.md" }),
      });
    }
    if (url.startsWith("/api/docs")) return Promise.resolve({ ok: true, json: async () => DOCS_WITH_ENTRY });
    return Promise.resolve({ ok: true, json: async () => [] });
  });

  return { fetchMock, calls };
}

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

  // s1 (consus-phase25-project-registration-ux): GET /api/projects now
  // returns a `paths` map alongside `projects` — the selected project's
  // repo path renders as a labeled field (not bare text) near its
  // name/actions, and only once a project is actually selected.
  it("shows the selected project's repo path as a labeled field", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchImpl({
        "/api/decisions": [],
        "/api/kb-entries": [KB_ENTRY],
        "/api/diagrams": DIAGRAM_RESPONSE,
        "/api/items/": [],
        "GET /api/docs?project=consus": DOCS_WITH_ENTRY,
        "GET /api/projects": { projects: ["consus"], paths: { consus: "/tmp/consus-repo" } },
      }),
    );

    render(<App />);
    await openConsusProject();

    expect(await screen.findByText("Project path")).toBeInTheDocument();
    expect(screen.getByTestId("project-path-field")).toHaveTextContent("Project path — /tmp/consus-repo");
  });

  it("shows no path field in the All projects view — path is per-project metadata", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchImpl({
        "/api/decisions": [],
        "/api/kb-entries": [KB_ENTRY],
        "/api/diagrams": DIAGRAM_RESPONSE,
        "/api/items/": [],
        "GET /api/docs?project=consus": DOCS_WITH_ENTRY,
        "GET /api/projects": { projects: ["consus"], paths: { consus: "/tmp/consus-repo" } },
      }),
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "consus" })).toBeInTheDocument());

    expect(screen.queryByText("Project path")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-path-field")).not.toBeInTheDocument();
  });
});

describe("App — branch picker, branch-scoped decisions, doc diff (consus-phase24 s4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC1 regression: an operator who never touches the picker sees byte-identical Projects-tab behavior — no branch-scoped/diff/ref-ingest calls fire", async () => {
    const { fetchMock, calls } = branchFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();

    // Existing per-project surfaces render exactly as before this story.
    expect(await screen.findByText("Architecture note")).toBeInTheDocument();
    expect(await screen.findByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ingest repo/i })).toBeInTheDocument();

    // The picker itself is present (additive UI) and populated...
    expect(await screen.findByRole("combobox", { name: "Select branch" })).toBeInTheDocument();

    // ...but nothing about "(default)" being selected fires a branch-scoped
    // decisions fetch, a ref-aware ingest, or a doc-diff check.
    expect(calls.some((c) => c.includes("branch="))).toBe(false);
    expect(calls.some((c) => c.includes("ingest?ref="))).toBe(false);
    expect(calls.some((c) => c.startsWith("GET /api/docs/diff"))).toBe(false);
  });

  it("the global Decisions tab keeps fetching the exact same unfiltered /api/decisions?all=1 — untouched by this story", async () => {
    const { fetchMock, calls } = branchFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Decisions" })).toBeInTheDocument();

    expect(calls).toContain("GET /api/decisions?all=1");
  });

  it("AC2: selecting a branch scans it (ref-aware ingest) and re-scopes the decisions list to that branch's items only", async () => {
    const { fetchMock } = branchFetchMock({
      branches: ["feature/x"],
      branchDecisions: [{ id: "d1", title: "Branch-only decision", status: "active", decided_at: null }],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();

    const select = await screen.findByRole("combobox", { name: "Select branch" });
    await waitFor(() => expect(within(select).getByRole("option", { name: "feature/x" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "feature/x" } });

    expect(await screen.findByText("Branch-only decision")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/consus/ingest?ref=feature%2Fx"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("AC2: switching back to '(default)' is the way back — it removes the branch-scoped decisions panel", async () => {
    const { fetchMock } = branchFetchMock({
      branches: ["feature/x"],
      branchDecisions: [{ id: "d1", title: "Branch-only decision", status: "active", decided_at: null }],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();

    const select = await screen.findByRole("combobox", { name: "Select branch" });
    await waitFor(() => expect(within(select).getByRole("option", { name: "feature/x" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "feature/x" } });
    expect(await screen.findByText("Branch-only decision")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(screen.queryByText("Branch-only decision")).not.toBeInTheDocument());
  });

  it("AC5: a project with zero non-default branches gracefully shows only '(default)' in the picker — no error, no crash", async () => {
    const { fetchMock } = branchFetchMock({ branches: [] });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();

    const select = (await screen.findByRole("combobox", { name: "Select branch" })) as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(1));
    expect(select.options[0].textContent).toBe("(default)");
  });

  it("AC3: a doc that differs on the selected branch offers a 'view diff' action that renders the diff inline via a plain <pre>", async () => {
    const { fetchMock } = branchFetchMock({ branches: ["feature/x"], docDiff: { diff: "- old line\n+ new line" } });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();

    const select = await screen.findByRole("combobox", { name: "Select branch" });
    await waitFor(() => expect(within(select).getByRole("option", { name: "feature/x" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "feature/x" } });

    fireEvent.click(await screen.findByText("architecture.md"));
    fireEvent.click(await screen.findByRole("button", { name: "View diff vs default branch" }));

    const pre = await screen.findByTestId("doc-diff");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe("- old line\n+ new line");
  });

  it("AC4: a doc identical on the selected branch shows a clear 'no changes' indication, not a silent no-op", async () => {
    const { fetchMock } = branchFetchMock({ branches: ["feature/x"], docDiff: { diff: null } });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();

    const select = await screen.findByRole("combobox", { name: "Select branch" });
    await waitFor(() => expect(within(select).getByRole("option", { name: "feature/x" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "feature/x" } });

    fireEvent.click(await screen.findByText("architecture.md"));
    fireEvent.click(await screen.findByRole("button", { name: "View diff vs default branch" }));

    expect(await screen.findByTestId("doc-diff-none")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-diff")).not.toBeInTheDocument();
  });

  it("no 'view diff' action appears while '(default)' is selected — there is no branch to diff against", async () => {
    const { fetchMock } = branchFetchMock({ branches: ["feature/x"] });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();

    fireEvent.click(await screen.findByText("architecture.md"));
    expect(screen.queryByRole("button", { name: "View diff vs default branch" })).not.toBeInTheDocument();
  });

  it("switching the selected project resets the branch back to '(default)' — a branch picked for one project has no meaning for another", async () => {
    const { fetchMock } = branchFetchMock({
      branches: ["feature/x"],
      branchDecisions: [{ id: "d1", title: "Branch-only decision", status: "active", decided_at: null }],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();

    const select = await screen.findByRole("combobox", { name: "Select branch" });
    await waitFor(() => expect(within(select).getByRole("option", { name: "feature/x" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "feature/x" } });
    expect(await screen.findByText("Branch-only decision")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All projects" }));
    fireEvent.click(screen.getByRole("button", { name: "consus" }));

    const selectAfter = (await screen.findByRole("combobox", { name: "Select branch" })) as HTMLSelectElement;
    expect(selectAfter.value).toBe("");
    expect(screen.queryByText("Branch-only decision")).not.toBeInTheDocument();
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
    expect(screen.getByText(/claude code/i)).toBeInTheDocument();
    expect(screen.getByText(/codex cli/i)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* App — Events tab (p14-5): the UI over p14-3's event routes.        */
/* ------------------------------------------------------------------ */

interface EventRowLike {
  id: string;
  project: string;
  trigger_kind: "doc_changed" | "decision_needed";
  source_repo: string;
  source_path: string;
  content_hash: string;
  previous_hash: string | null;
  diff: string | null;
  item_id: string | null;
  composed_prompt: string;
  status: "new" | "in_progress" | "done" | "dismissed";
  detected_at: string;
  status_updated_at: string;
  archived_at: string | null;
  proposal_id: string | null;
}

const EVENT_DOC_CHANGED: EventRowLike = {
  id: "evt-1",
  project: "consus",
  trigger_kind: "doc_changed",
  source_repo: "consus",
  source_path: "docs/architecture.md",
  content_hash: "hash-1",
  previous_hash: "hash-0",
  diff: "  line one\n+ line two",
  item_id: null,
  composed_prompt: "review the doc change",
  status: "new",
  detected_at: "2026-08-10T00:00:00Z",
  status_updated_at: "2026-08-10T00:00:00Z",
  archived_at: null,
  proposal_id: null,
};

const EVENT_DECISION_NEEDED: EventRowLike = {
  id: "evt-2",
  project: "other-repo",
  trigger_kind: "decision_needed",
  source_repo: "other-repo",
  source_path: "docs/decision.md",
  content_hash: "hash-2",
  previous_hash: null,
  diff: null,
  item_id: null,
  composed_prompt: "a decision is needed",
  status: "new",
  detected_at: "2026-08-11T00:00:00Z",
  status_updated_at: "2026-08-11T00:00:00Z",
  archived_at: null,
  proposal_id: null,
};

const EVENT_DISMISSED: EventRowLike = {
  id: "evt-3",
  project: "consus",
  trigger_kind: "doc_changed",
  source_repo: "consus",
  source_path: "docs/old.md",
  content_hash: "hash-3",
  previous_hash: "hash-2",
  diff: "  old line",
  item_id: null,
  composed_prompt: "old change",
  status: "dismissed",
  detected_at: "2026-08-01T00:00:00Z",
  status_updated_at: "2026-08-02T00:00:00Z",
  archived_at: "2026-08-02T00:00:00Z",
  proposal_id: null,
};

function jsonOk(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

/** A stateful fetch mock for the Events tab — GET /api/events and
 *  GET /api/events/history each derive from the same underlying array
 *  (split on archived_at, matching the real two-route/one-table split),
 *  and PATCH .../status + POST .../propose mutate that array so a
 *  subsequent re-fetch (e.g. after scan-all or propose) reflects the
 *  change, the same way the real backend would. */
function buildEventsFetchMock(initialEvents: EventRowLike[], projects: string[] = ["consus", "other-repo"]) {
  let events = initialEvents.map((e) => ({ ...e }));
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];

  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });

    if (method === "GET" && url.startsWith("/api/decisions")) return jsonOk([]);
    if (method === "GET" && url.startsWith("/api/kb-entries")) return jsonOk([KB_ENTRY]);
    if (method === "GET" && url.startsWith("/api/docs")) return jsonOk(DOCS_WITH_ENTRY);
    if (method === "GET" && url.startsWith("/api/projects")) return jsonOk({ projects });

    if (method === "GET" && (url === "/api/events/history" || url.startsWith("/api/events/history?"))) {
      return jsonOk(events.filter((e) => e.archived_at !== null));
    }
    if (method === "GET" && (url === "/api/events" || url.startsWith("/api/events?"))) {
      return jsonOk(events.filter((e) => e.archived_at === null));
    }

    const statusMatch = /^\/api\/events\/([^/]+)\/status$/.exec(url);
    if (method === "PATCH" && statusMatch) {
      const id = statusMatch[1];
      const nextStatus = body?.status as EventRowLike["status"];
      events = events.map((e) => {
        if (e.id !== id) return e;
        const archived_at =
          nextStatus === "done" || nextStatus === "dismissed" ? (e.archived_at ?? "2026-08-12T00:00:00Z") : null;
        return { ...e, status: nextStatus, status_updated_at: "2026-08-12T00:00:00Z", archived_at };
      });
      return jsonOk(events.find((e) => e.id === id));
    }

    const proposeMatch = /^\/api\/events\/([^/]+)\/propose$/.exec(url);
    if (method === "POST" && proposeMatch) {
      const id = proposeMatch[1];
      events = events.map((e) => (e.id === id ? { ...e, proposal_id: "proposal-1" } : e));
      return jsonOk({ event: events.find((e) => e.id === id), proposal: { id: "proposal-1", status: "pending" } });
    }

    return jsonOk([]);
  });

  return { fn, calls };
}

async function openEventsTab() {
  fireEvent.click(await screen.findByRole("button", { name: "Events" }));
}

function lastCallTo(calls: { method: string; url: string }[], predicate: (url: string, method: string) => boolean) {
  return [...calls].reverse().find((c) => predicate(c.url, c.method));
}

describe("App — Events tab (p14-5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads with no query params and renders every non-archived event across both projects", async () => {
    const { fn, calls } = buildEventsFetchMock([EVENT_DOC_CHANGED, EVENT_DECISION_NEEDED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();

    expect(await screen.findByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.getByText("docs/decision.md")).toBeInTheDocument();
    const rowOne = screen.getByTestId("event-row-evt-1");
    const rowTwo = screen.getByTestId("event-row-evt-2");
    expect(within(rowOne).getByText("consus")).toBeInTheDocument();
    expect(within(rowTwo).getByText("other-repo")).toBeInTheDocument();
    expect(within(rowOne).getByText("doc_changed")).toBeInTheDocument();
    expect(within(rowTwo).getByText("decision_needed")).toBeInTheDocument();
    expect(within(rowOne).getByText("2026-08-10T00:00:00Z")).toBeInTheDocument();

    const initialLoad = calls.find((c) => c.method === "GET" && c.url === "/api/events");
    expect(initialLoad).toBeTruthy();
  });

  it("re-fetches with a project param when a project is selected, and with none when reset to All projects", async () => {
    const { fn, calls } = buildEventsFetchMock([EVENT_DOC_CHANGED, EVENT_DECISION_NEEDED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    fireEvent.change(screen.getByRole("combobox", { name: /filter by project/i }), {
      target: { value: "consus" },
    });

    await waitFor(() => {
      expect(lastCallTo(calls, (url, m) => m === "GET" && url.startsWith("/api/events?"))?.url).toContain(
        "project=consus",
      );
    });

    fireEvent.change(screen.getByRole("combobox", { name: /filter by project/i }), {
      target: { value: "" },
    });

    await waitFor(() => {
      const call = lastCallTo(
        calls,
        (url, m) => m === "GET" && (url === "/api/events" || url.startsWith("/api/events?")),
      );
      expect(call?.url).not.toContain("project=");
    });
  });

  it("re-fetches with status/sort/order query params when those filters change", async () => {
    const { fn, calls } = buildEventsFetchMock([EVENT_DOC_CHANGED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    fireEvent.change(screen.getByRole("combobox", { name: /filter by status/i }), {
      target: { value: "in_progress" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /^sort by$/i }), { target: { value: "status" } });
    fireEvent.change(screen.getByRole("combobox", { name: /sort order/i }), { target: { value: "asc" } });

    await waitFor(() => {
      const call = lastCallTo(calls, (url, m) => m === "GET" && url.startsWith("/api/events?"));
      expect(call?.url).toContain("status=in_progress");
      expect(call?.url).toContain("sort=status");
      expect(call?.url).toContain("order=asc");
    });
  });

  it("scan-all shows an in-flight state, re-fetches events on success, and surfaces a per-project failure as a warning", async () => {
    let resolveScan: (value: unknown) => void = () => {};
    const scanResponse = new Promise((resolve) => {
      resolveScan = resolve;
    });

    const { fn, calls } = buildEventsFetchMock([EVENT_DOC_CHANGED]);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (method === "POST" && url === "/api/projects/scan-all") {
        calls.push({ method, url });
        return scanResponse;
      }
      return fn(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    const eventsCallsBefore = calls.filter((c) => c.method === "GET" && c.url.startsWith("/api/events")).length;

    fireEvent.click(screen.getByRole("button", { name: /scan all projects/i }));
    expect(screen.getByRole("button", { name: /scanning/i })).toBeDisabled();

    resolveScan({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { project: "consus", ok: true, docsScanned: 3, eventsCreated: 1 },
          { project: "other-repo", ok: false, error: "permission denied" },
        ],
      }),
    });

    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^scan all projects$/i })).toBeEnabled();

    const eventsCallsAfter = calls.filter((c) => c.method === "GET" && c.url.startsWith("/api/events")).length;
    expect(eventsCallsAfter).toBeGreaterThan(eventsCallsBefore);
  });

  it("shows a visible error and clears the in-flight state when scan-all fails", async () => {
    const { fn } = buildEventsFetchMock([EVENT_DOC_CHANGED]);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (method === "POST" && url === "/api/projects/scan-all") {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "scan-all failed" }) });
      }
      return fn(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    fireEvent.click(screen.getByRole("button", { name: /scan all projects/i }));

    expect(await screen.findByText("scan-all failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^scan all projects$/i })).toBeEnabled();
  });

  it("changing a 'new' event's status to in_progress PATCHes and keeps the row in the active list", async () => {
    const { fn, calls } = buildEventsFetchMock([EVENT_DOC_CHANGED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    fireEvent.change(screen.getByRole("combobox", { name: /status for docs\/architecture\.md/i }), {
      target: { value: "in_progress" },
    });

    await waitFor(() => {
      const patchCall = calls.find((c) => c.method === "PATCH" && c.url === "/api/events/evt-1/status");
      expect(patchCall?.body).toEqual({ status: "in_progress" });
    });

    expect(await screen.findByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /status for docs\/architecture\.md/i })).toHaveValue("in_progress");
  });

  it("changing status to done or dismissed removes the row from the active list without a manual refresh", async () => {
    const { fn } = buildEventsFetchMock([EVENT_DOC_CHANGED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    fireEvent.change(screen.getByRole("combobox", { name: /status for docs\/architecture\.md/i }), {
      target: { value: "dismissed" },
    });

    await waitFor(() => {
      expect(screen.queryByText("docs/architecture.md")).not.toBeInTheDocument();
    });
    expect(screen.getByText("No events yet")).toBeInTheDocument();
  });

  it("switching to Archived fetches GET /api/events/history and renders only archived events", async () => {
    const { fn, calls } = buildEventsFetchMock([EVENT_DOC_CHANGED, EVENT_DISMISSED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByText("docs/old.md")).toBeInTheDocument();
    expect(screen.queryByText("docs/architecture.md")).not.toBeInTheDocument();

    const historyCall = calls.find((c) => c.method === "GET" && c.url.startsWith("/api/events/history"));
    expect(historyCall).toBeTruthy();
  });

  it("moving a dismissed event back to new/in_progress from the Archived view removes it from that view", async () => {
    const { fn } = buildEventsFetchMock([EVENT_DISMISSED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("docs/old.md");

    fireEvent.change(screen.getByRole("combobox", { name: /status for docs\/old\.md/i }), {
      target: { value: "new" },
    });

    await waitFor(() => {
      expect(screen.queryByText("docs/old.md")).not.toBeInTheDocument();
    });
    expect(screen.getByText("No archived events")).toBeInTheDocument();
  });

  it("opens the propose composer pre-filled with the event's diff, empty description, and Propose disabled", async () => {
    const { fn } = buildEventsFetchMock([EVENT_DOC_CHANGED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));

    expect(screen.getByTestId("event-diff")).toHaveTextContent("line two");
    expect(screen.getByRole("textbox", { name: /description/i })).toHaveValue("");
    expect(screen.getByRole("button", { name: /^propose$/i })).toBeDisabled();
  });

  it("does not offer a propose action for a decision_needed (null-diff) event", async () => {
    const { fn } = buildEventsFetchMock([EVENT_DECISION_NEEDED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/decision.md");

    expect(screen.queryByRole("button", { name: /propose a change/i })).not.toBeInTheDocument();
  });

  it("submitting the composer POSTs description + requestedBy, closes on success, and the row shows it now has a proposal", async () => {
    const { fn, calls } = buildEventsFetchMock([EVENT_DOC_CHANGED]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /description/i }), {
      target: { value: "please review this doc change" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    await waitFor(() => {
      const proposeCall = calls.find((c) => c.method === "POST" && c.url === "/api/events/evt-1/propose");
      expect(proposeCall?.body).toEqual({ description: "please review this doc change", requestedBy: "Mathew" });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("event-diff")).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/proposed/i)).toBeInTheDocument();
  });

  it("shows a visible error near the propose action when the propose request fails, without a stuck loading state", async () => {
    const { fn } = buildEventsFetchMock([EVENT_DOC_CHANGED]);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (method === "POST" && url === "/api/events/evt-1/propose") {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: "event has no diff" }) });
      }
      return fn(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openEventsTab();
    await screen.findByText("docs/architecture.md");

    fireEvent.click(screen.getByRole("button", { name: /propose a change/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /description/i }), {
      target: { value: "please review this doc change" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    expect(await screen.findByText("event has no diff")).toBeInTheDocument();
    // The composer stays open (not stuck loading) so the operator can retry.
    expect(screen.getByTestId("event-diff")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^propose$/i })).toBeEnabled();
  });
});

/* ------------------------------------------------------------------ */
/* App — Docs tab search (p14-6): a search box wired to               */
/* GET /api/docs/search, reusing DocsSection's existing open() flow.  */
/* ------------------------------------------------------------------ */

interface DocSearchResultLike {
  repo: string;
  file_path: string;
  epic: string | null;
  phase: string | null;
  matched: Array<"path" | "content">;
  content_hash: string;
  last_scanned_at: string;
}

function buildDocsSearchFetchMock(opts: { searchResults?: DocSearchResultLike[]; searchError?: boolean }) {
  const calls: { method: string; url: string }[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url });

    // Checked before the plain /api/docs branch below, since
    // /api/docs/search also starts with "/api/docs".
    if (url.startsWith("/api/docs/search")) {
      if (opts.searchError) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "search failed" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ query: "x", results: opts.searchResults ?? [] }) });
    }
    if (url.startsWith("/api/docs")) return Promise.resolve({ ok: true, json: async () => DOCS_WITH_ENTRY });
    if (url.startsWith("/api/decisions")) return Promise.resolve({ ok: true, json: async () => [] });
    if (url.startsWith("/api/kb-entries")) return Promise.resolve({ ok: true, json: async () => [KB_ENTRY] });
    if (url.startsWith("/api/diagrams")) return Promise.resolve({ ok: true, json: async () => DIAGRAM_RESPONSE });
    if (url.startsWith("/api/items/")) return Promise.resolve({ ok: true, json: async () => [] });
    if (url.startsWith("/api/projects")) return Promise.resolve({ ok: true, json: async () => ({ projects: ["consus"] }) });
    return Promise.resolve({ ok: true, json: async () => [] });
  });
  return { fn, calls };
}

async function openDocsTab() {
  fireEvent.click(await screen.findByRole("button", { name: "Docs" }));
}

describe("App — Docs tab search (p14-6)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires GET /api/docs/search?q=<query> once the debounce elapses, and renders matching results", async () => {
    const { fn, calls } = buildDocsSearchFetchMock({
      searchResults: [
        {
          repo: "consus",
          file_path: "docs/other.md",
          epic: null,
          phase: "docs",
          matched: ["path"],
          content_hash: "x",
          last_scanned_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openDocsTab();
    await screen.findByText("architecture.md");

    fireEvent.change(screen.getByRole("searchbox", { name: /search docs/i }), { target: { value: "other" } });

    await waitFor(
      () => {
        const call = calls.find((c) => c.method === "GET" && c.url.startsWith("/api/docs/search"));
        expect(call?.url).toBe("/api/docs/search?q=other");
      },
      { timeout: 2000 },
    );

    expect(await screen.findByText("docs/other.md", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("shows a visible error near the search box when the search request fails, without breaking the tree underneath", async () => {
    const { fn } = buildDocsSearchFetchMock({ searchError: true });
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openDocsTab();
    await screen.findByText("architecture.md");

    fireEvent.change(screen.getByRole("searchbox", { name: /search docs/i }), { target: { value: "boom" } });

    expect(await screen.findByText(/search failed/i, {}, { timeout: 2000 })).toBeInTheDocument();
    // A failed search never blocks browsing — the tree stays usable.
    const treeButton = screen.getByText("architecture.md");
    expect(treeButton).toBeInTheDocument();
    expect(treeButton.closest("button")).toBeEnabled();
  });

  it("shows an empty-results message distinct from the 'no docs indexed yet' empty state", async () => {
    const { fn } = buildDocsSearchFetchMock({ searchResults: [] });
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openDocsTab();
    await screen.findByText("architecture.md");

    fireEvent.change(screen.getByRole("searchbox", { name: /search docs/i }), {
      target: { value: "nothing-matches" },
    });

    expect(await screen.findByText(/no docs match/i, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText("No docs indexed yet")).not.toBeInTheDocument();
  });

  it("clearing the search box returns to the plain tree view with no stale results", async () => {
    const { fn } = buildDocsSearchFetchMock({
      searchResults: [
        {
          repo: "consus",
          file_path: "docs/other.md",
          epic: null,
          phase: "docs",
          matched: ["path"],
          content_hash: "x",
          last_scanned_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await openDocsTab();
    await screen.findByText("architecture.md");

    const input = screen.getByRole("searchbox", { name: /search docs/i });
    fireEvent.change(input, { target: { value: "other" } });

    expect(await screen.findByText("docs/other.md", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText("architecture.md")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });

    await waitFor(
      () => {
        expect(screen.queryByText("docs/other.md")).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(await screen.findByText("architecture.md")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* App — Decisions tab two-pane layout (phase16 s1)                   */
/* ------------------------------------------------------------------ */

interface DecisionItemLike {
  id: string;
  type: string;
  title: string;
  status: string;
  source_repo: string | null;
  decided_at: string | null;
  decision_payload: null;
}

const DECISION_ONE: DecisionItemLike = {
  id: "item-1",
  type: "doc_ref",
  title: "Decision One",
  status: "open",
  source_repo: null,
  decided_at: null,
  decision_payload: null,
};

const DECISION_TWO: DecisionItemLike = {
  id: "item-2",
  type: "doc_ref",
  title: "Decision Two",
  status: "open",
  source_repo: null,
  decided_at: null,
  decision_payload: null,
};

const DECIDED_DECISION: DecisionItemLike = {
  id: "item-3",
  type: "doc_ref",
  title: "Decided Already",
  status: "closed",
  source_repo: null,
  decided_at: "2026-08-01T00:00:00Z",
  decision_payload: null,
};

/** A stateful fetch mock for the Decisions tab — GET /api/decisions?all=1
 *  serves the current in-memory array, and POST .../verdict mutates it
 *  (sets decided_at) so a subsequent reload() reflects the change, the
 *  same stateful-mock shape as buildEventsFetchMock above. */
function buildDecisionsFetchMock(initialDecisions: DecisionItemLike[]) {
  let decisions = initialDecisions.map((d) => ({ ...d }));
  const calls: { method: string; url: string }[] = [];

  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url });

    if (method === "GET" && url.startsWith("/api/decisions")) return jsonOk(decisions);

    const verdictMatch = /^\/api\/decisions\/([^/]+)\/verdict$/.exec(url);
    if (method === "POST" && verdictMatch) {
      const id = verdictMatch[1];
      decisions = decisions.map((d) => (d.id === id ? { ...d, decided_at: "2026-08-12T00:00:00Z" } : d));
      return jsonOk({ ok: true });
    }

    if (method === "GET" && url.startsWith("/api/kb-entries")) return jsonOk([KB_ENTRY]);
    if (method === "GET" && url.startsWith("/api/docs")) return jsonOk(DOCS_WITH_ENTRY);
    if (method === "GET" && url.startsWith("/api/projects")) return jsonOk({ projects: ["consus"] });
    if (method === "GET" && url.startsWith("/api/diagrams")) return jsonOk(DIAGRAM_RESPONSE);
    if (method === "GET" && url.startsWith("/api/items/")) return jsonOk([]);
    return jsonOk([]);
  });

  return { fn, calls };
}

function resetLocation() {
  window.history.pushState({}, "", "/");
}

describe("App — Decisions tab two-pane layout (phase16 s1)", () => {
  beforeEach(() => {
    resetLocation();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLocation();
  });

  it("renders a left list pane and a right detail pane as two distinct containers", async () => {
    const { fn } = buildDecisionsFetchMock([DECISION_ONE, DECISION_TWO]);
    vi.stubGlobal("fetch", fn);

    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Decision One" });

    const listPane = container.querySelector(".decisions-two-pane__list");
    const detailPane = container.querySelector(".decisions-two-pane__detail");
    expect(listPane).toBeInTheDocument();
    expect(detailPane).toBeInTheDocument();
    expect(listPane).not.toBe(detailPane);
    expect(within(listPane as HTMLElement).getByText("Decision Two")).toBeInTheDocument();
    expect(within(detailPane as HTMLElement).getByRole("heading", { name: "Decision One" })).toBeInTheDocument();
  });

  it("pre-selects the decision named by ?selected= on mount, without requiring a click", async () => {
    window.history.pushState({}, "", "/?selected=item-2");
    const { fn } = buildDecisionsFetchMock([DECISION_ONE, DECISION_TWO]);
    vi.stubGlobal("fetch", fn);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Decision Two" })).toBeInTheDocument();
  });

  it("clicking a list row updates ?selected= and shows that decision's detail, without a page reload", async () => {
    const { fn } = buildDecisionsFetchMock([DECISION_ONE, DECISION_TWO]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await screen.findByRole("heading", { name: "Decision One" });

    fireEvent.click(screen.getByRole("option", { name: /Decision Two/ }));

    expect(await screen.findByRole("heading", { name: "Decision Two" })).toBeInTheDocument();
    expect(window.location.search).toBe("?selected=item-2");
  });

  it("falls back to the first open decision when ?selected= is missing, without rewriting the URL", async () => {
    const { fn } = buildDecisionsFetchMock([DECISION_ONE, DECISION_TWO]);
    vi.stubGlobal("fetch", fn);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Decision One" })).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("falls back to the first open decision when ?selected= names an unknown id, without rewriting the URL", async () => {
    window.history.pushState({}, "", "/?selected=does-not-exist");
    const { fn } = buildDecisionsFetchMock([DECISION_ONE, DECISION_TWO]);
    vi.stubGlobal("fetch", fn);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Decision One" })).toBeInTheDocument();
    expect(window.location.search).toBe("?selected=does-not-exist");
  });

  it("falls back to the first decided decision when there are no open decisions", async () => {
    const { fn } = buildDecisionsFetchMock([DECIDED_DECISION]);
    vi.stubGlobal("fetch", fn);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Decided Already" })).toBeInTheDocument();
    expect(screen.getByText("Nothing waiting on you")).toBeInTheDocument();
  });

  it("shows an explicit empty-state message in the detail pane when there are no decisions at all", async () => {
    vi.stubGlobal("fetch", firstRunFetchMock({ decisions: [], docs: DOCS_WITH_ENTRY, kbEntries: [KB_ENTRY] }));

    render(<App />);

    expect(await screen.findByText("Select a decision to see its details")).toBeInTheDocument();
  });

  it("keeps the same decision selected across a verdict-triggered reload, reflecting its updated decided state", async () => {
    const { fn } = buildDecisionsFetchMock([DECISION_ONE, DECISION_TWO]);
    vi.stubGlobal("fetch", fn);

    render(<App />);
    await screen.findByRole("heading", { name: "Decision One" });

    fireEvent.click(screen.getByRole("option", { name: /Decision Two/ }));
    await screen.findByRole("heading", { name: "Decision Two" });

    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));

    await waitFor(() => {
      expect(screen.getByText("Needs you (1)")).toBeInTheDocument();
      expect(screen.getByText("Decided (1)")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Decision Two" })).toBeInTheDocument();
    expect(window.location.search).toBe("?selected=item-2");
  });
});

/* ------------------------------------------------------------------ */
/* App — global pending-changes count across the two diagram kinds    */
/* (s2, consus-phase18) — DiagramView (cascade) and                   */
/* ArchitectureDiagramView are now both real, editable React Flow      */
/* canvases; ProjectsSection lifts each one's own pending-change count */
/* into one accurate global total, while each diagram's own dirty dot */
/* only lights up for the diagram that's actually dirty.              */
/* ------------------------------------------------------------------ */

const ARCHITECTURE_RESPONSE = {
  topLevel: 'graph TD\n  root["consus"]\n  root --> src["src"]',
  fullComponent: 'graph TD\n  root["consus"]\n  root --> src["src"]',
};

const CASCADE_WITH_STORIES = {
  itemId: "diagram:consus",
  epics: [
    {
      id: "epic-a",
      title: "Epic A",
      stories: [{ id: "s1", title: "Story One", complexity: "low", dependsOn: [] }],
    },
  ],
};

function diagramEditorFetchMock() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (method === "POST" && url === "/api/proposals") {
      return Promise.resolve({ ok: true, json: async () => ({ id: "prop-1", status: "pending" }) });
    }
    // Checked before the plain /api/diagrams branch below, since that
    // branch's own prefix ("/api/diagrams") also matches this URL.
    if (url.startsWith("/api/diagrams/consus/architecture")) {
      return Promise.resolve({ ok: true, json: async () => ARCHITECTURE_RESPONSE });
    }
    if (url.startsWith("/api/diagrams")) {
      return Promise.resolve({ ok: true, json: async () => CASCADE_WITH_STORIES });
    }
    if (url.startsWith("/api/decisions")) return Promise.resolve({ ok: true, json: async () => [] });
    if (url.startsWith("/api/kb-entries")) return Promise.resolve({ ok: true, json: async () => [KB_ENTRY] });
    if (url.startsWith("/api/docs")) return Promise.resolve({ ok: true, json: async () => DOCS_WITH_ENTRY });
    if (url.startsWith("/api/items/")) return Promise.resolve({ ok: true, json: async () => [] });
    if (url.startsWith("/api/projects")) return Promise.resolve({ ok: true, json: async () => ({ projects: ["consus"] }) });
    return Promise.resolve({ ok: true, json: async () => [] });
  });
}

describe("App — diagram editor global pending count (s2, consus-phase18)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an accurate global total across both diagram kinds, with only the dirty one's dot lit", async () => {
    vi.stubGlobal("fetch", diagramEditorFetchMock());

    render(<App />);
    await openConsusProject();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByTestId("diagram-pending-count")).toHaveTextContent("0 pending changes");
    expect(screen.queryByTestId("diagram-dirty-dot")).not.toBeInTheDocument();

    // index 0 = the cascade's own canvas (DiagramView renders first),
    // index 1 = the architecture diagram's canvas (renders second) — see
    // ProjectsSection's render order.
    const addButtons = screen.getAllByTestId("diagram-canvas-add-node");
    expect(addButtons).toHaveLength(2);

    fireEvent.click(addButtons[1]); // edit architecture only

    await waitFor(() => expect(screen.getByTestId("diagram-pending-count")).toHaveTextContent("1 pending change"));
    expect(screen.getAllByTestId("diagram-dirty-dot")).toHaveLength(1); // only architecture's dot, not the cascade's

    fireEvent.click(addButtons[0]); // now edit the cascade too

    await waitFor(() => expect(screen.getByTestId("diagram-pending-count")).toHaveTextContent("2 pending changes"));
    expect(screen.getAllByTestId("diagram-dirty-dot")).toHaveLength(2);
  });

  it("fires the architecture diagram's proposal via POST /api/proposals with the reconstructed diagram:<repo> itemId", async () => {
    const fetchMock = diagramEditorFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openConsusProject();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const addButtons = screen.getAllByTestId("diagram-canvas-add-node");
    fireEvent.click(addButtons[1]);

    const fireButtons = screen.getAllByRole("button", { name: /fire to harness/i });
    expect(fireButtons).toHaveLength(2);
    fireEvent.click(fireButtons[1]);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => u === "/api/proposals" && (i as RequestInit | undefined)?.method === "POST");
      expect(call).toBeDefined();
    });
    const [, postInit] = fetchMock.mock.calls.find(
      ([u, i]) => u === "/api/proposals" && (i as RequestInit | undefined)?.method === "POST",
    )!;
    const body = JSON.parse((postInit as RequestInit).body as string);
    expect(body).toMatchObject({ itemId: "diagram:consus", targetType: "diagram", requestedBy: "Mathew" });
    expect(body.diff).toContain("+ node New node 1");
    expect(body.description).toMatch(/1 change/);
  });
});
