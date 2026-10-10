import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ThreadsPanel, anchorLabel, type Thread } from "./ThreadsPanel";
import { docSectionAnchors, diagramNodeAnchors } from "./anchors";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function jsonRes(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

const T0 = "2026-10-10T21:00:00.000Z";

function operatorMsg(id: number, body: string, status: "pending" | "delivered" | "failed" = "delivered", error: string | null = null) {
  return {
    id,
    threadId: "t1",
    role: "operator" as const,
    author: "Mathew",
    body,
    proposalId: null,
    proposalUrl: null,
    proposal: null,
    delivery: { status, error, target: "webhook", attemptedAt: T0 },
    createdAt: T0,
  };
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "t1",
    itemType: "doc",
    itemId: "doc-1",
    anchor: { section: "Install", line: 3 },
    state: "awaiting_agent",
    createdAt: T0,
    updatedAt: T0,
    messages: [operatorMsg(1, "Is step 2 right?")],
    ...overrides,
  };
}

const agentReply = {
  id: 2,
  threadId: "t1",
  role: "agent" as const,
  author: "pantheon:auriga",
  body: "No, I opened a fix.",
  proposalId: "p-1",
  proposalUrl: null,
  proposal: { id: "p-1", status: "pending", description: "Fix step 2", targetType: "doc" },
  delivery: null,
  createdAt: T0,
};

describe("ThreadsPanel", () => {
  let calls: Array<{ method: string; url: string; body?: unknown }>;
  let initial: Thread[];

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    calls = [];
    initial = [thread()];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        calls.push({ method, url, body });
        if (method === "GET" && url === "/api/threads?itemType=doc&itemId=doc-1") return jsonRes(200, initial);
        if (method === "POST" && url === "/api/threads") {
          return jsonRes(201, thread({ id: "t2", anchor: body.anchor ?? null, messages: [{ ...operatorMsg(5, body.body), threadId: "t2" }] }));
        }
        if (method === "POST" && url === "/api/threads/t1/redeliver") return jsonRes(200, thread());
        if (method === "GET" && url === "/api/proposals/p-1") {
          return jsonRes(200, { id: "p-1", status: "pending", description: "Fix step 2", diff: "-old step\n+new step", applied_diff: null });
        }
        return jsonRes(404, {});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows existing threads with their anchor and a waiting-for-agent state, and opens a filtered stream", async () => {
    render(<ThreadsPanel itemType="doc" itemId="doc-1" />);
    expect(await screen.findByText("Is step 2 right?")).toBeTruthy();
    expect(screen.getByText("§ Install, line 3")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Waiting for agent…");
    expect(FakeEventSource.instances[0].url).toBe("/api/threads/stream?itemType=doc&itemId=doc-1");
  });

  it("renders the agent's reply pushed over the stream without a reload", async () => {
    render(<ThreadsPanel itemType="doc" itemId="doc-1" />);
    await screen.findByText("Is step 2 right?");
    const getsBefore = calls.filter((c) => c.method === "GET").length;

    act(() => {
      FakeEventSource.instances[0].emit("thread", thread({ state: "answered", messages: [operatorMsg(1, "Is step 2 right?"), agentReply] }));
    });

    expect(await screen.findByText("No, I opened a fix.")).toBeTruthy();
    expect(screen.getByText("agent")).toBeTruthy();
    expect(screen.queryByText("Waiting for agent…")).toBeNull();
    expect(calls.filter((c) => c.method === "GET").length).toBe(getsBefore);
  });

  it("'View change' expands the linked proposal's diff inline", async () => {
    initial = [thread({ state: "answered", messages: [operatorMsg(1, "Is step 2 right?"), agentReply] })];
    render(<ThreadsPanel itemType="doc" itemId="doc-1" />);
    expect(await screen.findByText("Proposed change (pending): Fix step 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View change" }));
    await waitFor(() => expect(screen.getByText(/\+new step/)).toBeTruthy());
    expect(calls.some((c) => c.url === "/api/proposals/p-1")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hide change" }));
    expect(screen.queryByText(/\+new step/)).toBeNull();
  });

  it("links an external proposalUrl", async () => {
    initial = [
      thread({
        state: "answered",
        messages: [operatorMsg(1, "q"), { ...agentReply, proposalId: null, proposal: null, proposalUrl: "https://example.com/pr/1" }],
      }),
    ];
    render(<ThreadsPanel itemType="doc" itemId="doc-1" />);
    const link = await screen.findByRole("link", { name: "View change ↗" });
    expect(link.getAttribute("href")).toBe("https://example.com/pr/1");
  });

  it("starts a thread on a chosen anchor", async () => {
    render(
      <ThreadsPanel itemType="doc" itemId="doc-1" anchors={[{ label: "Usage", anchor: { section: "Usage", line: 10 } }]} />,
    );
    await screen.findByText("Is step 2 right?");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Ask an agent"), { target: { value: "  Explain usage  " } });
    fireEvent.click(screen.getByRole("button", { name: "Ask agent" }));

    expect(await screen.findByText("Explain usage")).toBeTruthy();
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/threads")!;
    expect(post.body).toEqual({ itemType: "doc", itemId: "doc-1", body: "Explain usage", author: "Mathew", anchor: { section: "Usage", line: 10 } });
  });

  it("shows a delivery failure and retries by hand", async () => {
    initial = [thread({ state: "delivery_failed", messages: [operatorMsg(1, "hello", "failed", "HTTP 503")] })];
    render(<ThreadsPanel itemType="doc" itemId="doc-1" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Not delivered: HTTP 503");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Waiting for agent…"));
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/threads/t1/redeliver")).toBe(true);
  });

  it("closes its stream on unmount", async () => {
    const { unmount } = render(<ThreadsPanel itemType="doc" itemId="doc-1" />);
    await screen.findByText("Is step 2 right?");
    unmount();
    expect(FakeEventSource.instances.every((s) => s.closed)).toBe(true);
  });
});

describe("thread anchors", () => {
  it("labels anchors", () => {
    expect(anchorLabel(null)).toBeNull();
    expect(anchorLabel({ line: 4, lineEnd: 9 })).toBe("lines 4–9");
    expect(anchorLabel({ nodeId: "s1" })).toBe("node s1");
    expect(anchorLabel({ custom: 1 })).toBe('{"custom":1}');
  });

  it("derives doc section anchors with start lines", () => {
    const md = "# Title\nintro\n\n## Install\nstep\n### Notes\nx\n";
    expect(docSectionAnchors(md)).toEqual([
      { label: "Title", anchor: { section: "Title", line: 1 } },
      { label: "Install", anchor: { section: "Install", line: 4 } },
      { label: "Notes", anchor: { section: "Notes", line: 6 } },
    ]);
  });

  it("derives diagram node anchors", () => {
    expect(
      diagramNodeAnchors([{ id: "e1", title: "Epic", stories: [{ id: "s1", title: "Story", complexity: null, dependsOn: [] }] }]),
    ).toEqual([
      { label: "Epic", anchor: { nodeId: "e1" } },
      { label: "Epic › Story", anchor: { nodeId: "s1" } },
    ]);
  });
});
