import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommentsPanel } from "./CommentsPanel";
import type { Comment } from "./CommentThread";

function jsonRes(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function buildCommentsFetchMock(initial: Comment[]) {
  let comments = [...initial];
  let nextId = comments.length + 1;
  const calls: { method: string; url: string; body?: unknown }[] = [];

  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });

    if (method === "GET" && url === "/api/items/item-1/comments") {
      return jsonRes(200, comments);
    }

    if (method === "POST" && url === "/api/items/item-1/comments") {
      const created: Comment = { id: nextId++, author: body.author, body: body.body, createdAt: "2026-08-12T00:00:00Z" };
      comments = [...comments, created];
      return jsonRes(201, created);
    }

    return jsonRes(404, {});
  });

  return { fn, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CommentsPanel", () => {
  it("loads and renders the item's existing comment thread", async () => {
    const { fn } = buildCommentsFetchMock([{ id: 1, author: "Mathew", body: "First note", createdAt: "2026-08-01T00:00:00Z" }]);
    vi.stubGlobal("fetch", fn);

    render(<CommentsPanel itemId="item-1" />);

    await waitFor(() => expect(screen.getByText("First note")).toBeInTheDocument());
    expect(fn).toHaveBeenCalledWith("/api/items/item-1/comments");
  });

  it("posts a new comment scoped to this item and reloads the thread", async () => {
    const { fn, calls } = buildCommentsFetchMock([]);
    vi.stubGlobal("fetch", fn);

    render(<CommentsPanel itemId="item-1" />);
    await waitFor(() => expect(screen.getByLabelText(/add a comment/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/add a comment/i), { target: { value: "New note" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByText("New note")).toBeInTheDocument());

    const postCall = calls.find((c) => c.method === "POST");
    expect(postCall?.body).toEqual({ author: "Mathew", body: "New note" });
  });

  it("shows a real error when posting a comment fails, without losing the existing thread", async () => {
    const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/items/item-1/comments") {
        return jsonRes(200, [{ id: 1, author: "Mathew", body: "Existing note", createdAt: "2026-08-01T00:00:00Z" }]);
      }
      if (method === "POST") return jsonRes(500, {});
      return jsonRes(404, {});
    });
    vi.stubGlobal("fetch", fn);

    render(<CommentsPanel itemId="item-1" />);
    await waitFor(() => expect(screen.getByText("Existing note")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/add a comment/i), { target: { value: "Will fail" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByText(/could not post comment/i)).toBeInTheDocument());
    expect(screen.getByText("Existing note")).toBeInTheDocument();
  });
});
