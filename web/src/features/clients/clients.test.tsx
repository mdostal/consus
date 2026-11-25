import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { App } from "../../App";
import { clientNames, projectInClient } from "./ClientScope";
import { SELECTED_CLIENT_STORAGE_KEY } from "./useSelectedClient";

const PROJECT_CLIENTS = { flayr: "Firefly", venues: "Firefly", consus: "Pantheon", scratch: null };

const INBOX = [
  {
    kind: "question",
    key: "question:decision:flayr:q",
    itemId: "decision:flayr:q",
    itemType: "decision",
    isDecision: true,
    title: "Ship the feed?",
    repo: "flayr",
    client: "Firefly",
    at: "2026-10-10T00:00:00.000Z",
    detail: null,
  },
  {
    kind: "proposal",
    key: "proposal:p1",
    itemId: "diagram:consus",
    itemType: "diagram",
    isDecision: false,
    title: "consus diagram",
    repo: "consus",
    client: "Pantheon",
    at: "2026-10-09T00:00:00.000Z",
    detail: "Rename the core box",
    proposalId: "p1",
  },
];

const DECISIONS = [
  { id: "decision:flayr:q", type: "decision", title: "Ship the feed?", status: "active", source_repo: "flayr", decided_at: null, decision_payload: null },
  { id: "decision:consus:q", type: "decision", title: "Split the API?", status: "active", source_repo: "consus", decided_at: null, decision_payload: null },
];

function mockFetch() {
  const calls: string[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
    if (url === "/api/projects")
      return ok({ projects: Object.keys(PROJECT_CLIENTS), paths: {}, clients: PROJECT_CLIENTS });
    if (url.startsWith("/api/projects/")) return ok({ branches: [] });
    if (url === "/api/inbox") return ok({ items: INBOX });
    if (url === "/api/inbox/seen") return ok({ seen: true });
    if (url.startsWith("/api/decisions")) return ok(DECISIONS);
    if (url.startsWith("/api/diagrams")) return ok({ itemId: "diagram:x", epics: [] });
    if (url.startsWith("/api/docs")) return ok({ features: [], overview: [], brand: [] });
    if (url.startsWith("/api/kb-entries")) return ok([{ id: "kb", title: "x", source_repo: "flayr", created_at: "2026-01-01" }]);
    return ok([]);
  });
  return { fetchMock, calls };
}

function projectButtons(): string[] {
  const all = within(screen.getByRole("main")).getAllByRole("button");
  return all.map((b) => b.textContent ?? "").filter((t) => t in PROJECT_CLIENTS);
}

describe("client scope helpers", () => {
  it("lists distinct client names, sorted", () => {
    expect(clientNames(PROJECT_CLIENTS)).toEqual(["Firefly", "Pantheon"]);
    expect(clientNames({})).toEqual([]);
  });

  it("scopes projects to the selected client; All clients shows everything", () => {
    expect(projectInClient(PROJECT_CLIENTS, null, "scratch")).toBe(true);
    expect(projectInClient(PROJECT_CLIENTS, null, null)).toBe(true);
    expect(projectInClient(PROJECT_CLIENTS, "Firefly", "flayr")).toBe(true);
    expect(projectInClient(PROJECT_CLIENTS, "Firefly", "consus")).toBe(false);
    expect(projectInClient(PROJECT_CLIENTS, "Firefly", "scratch")).toBe(false);
    expect(projectInClient(PROJECT_CLIENTS, "Firefly", null)).toBe(false);
  });
});

describe("App — client switcher (PANT-960)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("switching clients changes the listed projects and is remembered per browser", async () => {
    vi.stubGlobal("fetch", mockFetch().fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
    const switcher = await screen.findByLabelText("Select client");
    await waitFor(() => expect(projectButtons()).toEqual(["flayr", "venues", "consus", "scratch"]));

    fireEvent.change(switcher, { target: { value: "Firefly" } });
    await waitFor(() => expect(projectButtons()).toEqual(["flayr", "venues"]));
    expect(window.localStorage.getItem(SELECTED_CLIENT_STORAGE_KEY)).toBe("Firefly");

    fireEvent.change(switcher, { target: { value: "Pantheon" } });
    await waitFor(() => expect(projectButtons()).toEqual(["consus"]));

    fireEvent.change(switcher, { target: { value: "" } });
    await waitFor(() => expect(projectButtons()).toHaveLength(4));
    expect(window.localStorage.getItem(SELECTED_CLIENT_STORAGE_KEY)).toBeNull();
  });

  it("restores the remembered client and scopes decisions to it", async () => {
    window.localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, "Pantheon");
    vi.stubGlobal("fetch", mockFetch().fetchMock);
    render(<App />);

    expect(await screen.findByLabelText("Select client")).toHaveValue("Pantheon");
    await waitFor(() => expect(screen.getAllByText("Split the API?").length).toBeGreaterThan(0));
    expect(screen.queryByText("Ship the feed?")).not.toBeInTheDocument();
  });

  it("falls back to All clients when the remembered client no longer exists", async () => {
    window.localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, "Gone");
    vi.stubGlobal("fetch", mockFetch().fetchMock);
    render(<App />);

    expect(await screen.findByLabelText("Select client")).toHaveValue("");
  });

  it("hides the switcher when no project has a client", async () => {
    const { fetchMock } = mockFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/projects"
          ? Promise.resolve({ ok: true, json: async () => ({ projects: ["consus"], paths: {}, clients: { consus: null } }) })
          : fetchMock(input, init),
      ),
    );
    render(<App />);
    await screen.findByRole("button", { name: "Inbox" });
    expect(screen.queryByLabelText("Select client")).not.toBeInTheDocument();
  });

  it("saves a project's client from the project view", async () => {
    const { fetchMock, calls } = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
    fireEvent.click(await screen.findByRole("button", { name: "scratch" }));
    const input = await screen.findByLabelText("Project client");
    fireEvent.change(input, { target: { value: "Firefly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save client" }));

    await waitFor(() => expect(calls).toContain("PATCH /api/projects/scratch"));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ client: "Firefly" });
  });
});

describe("App — cross-client inbox (PANT-960)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists every client's items with client and repo, regardless of the selected client", async () => {
    window.localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, "Pantheon");
    vi.stubGlobal("fetch", mockFetch().fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    const list = await screen.findByRole("list", { name: "Inbox" });
    expect(within(list).getByText("Ship the feed?")).toBeInTheDocument();
    expect(within(list).getByText("Firefly · flayr")).toBeInTheDocument();
    expect(within(list).getByText("Pantheon · consus")).toBeInTheDocument();
    expect(within(list).getByText("Waiting for result")).toBeInTheDocument();
  });

  it("opening a question switches to its client and selects it in Decisions", async () => {
    window.localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, "Pantheon");
    const { fetchMock, calls } = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    fireEvent.click(await screen.findByRole("button", { name: /Ship the feed\?/ }));

    await waitFor(() => expect(screen.getByLabelText("Select client")).toHaveValue("Firefly"));
    expect(new URLSearchParams(window.location.search).get("selected")).toBe("decision:flayr:q");
    expect(screen.getByRole("heading", { name: "Decisions" })).toBeInTheDocument();
    expect(calls).toContain("POST /api/inbox/seen");
  });

  it("opening a non-decision item jumps to its project", async () => {
    vi.stubGlobal("fetch", mockFetch().fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    fireEvent.click(await screen.findByRole("button", { name: /consus diagram/ }));

    await waitFor(() => expect(screen.getByLabelText("Select client")).toHaveValue("Pantheon"));
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Project client")).toHaveValue("Pantheon"));
  });
});
