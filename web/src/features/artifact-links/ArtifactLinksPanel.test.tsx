import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ArtifactLinksPanel, type ArtifactLinkRecord } from "./ArtifactLinksPanel";

function jsonRes(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

/** A stateful fetch mock for /api/items/:id/artifact-links (list+create),
 *  matching the real route s1 reuses — same stateful-mock convention as
 *  AttachmentsPanel.test.tsx's buildAttachmentsFetchMock. */
function buildArtifactLinksFetchMock(initial: ArtifactLinkRecord[], opts: { addFails?: { status: number; error: string } } = {}) {
  let links = [...initial];
  let nextId = links.length + 1;
  const calls: { method: string; url: string; body?: unknown }[] = [];

  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });

    if (method === "GET" && url === "/api/items/item-1/artifact-links") {
      return jsonRes(200, links);
    }

    if (method === "POST" && url === "/api/items/item-1/artifact-links") {
      if (opts.addFails) {
        return jsonRes(opts.addFails.status, { error: opts.addFails.error });
      }
      links = [...links, { id: nextId++, url: body.url, label: body.label ?? null }];
      return jsonRes(201, { ok: true });
    }

    return jsonRes(404, { error: "not found" });
  });

  return { fn, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ArtifactLinksPanel", () => {
  it("loads and renders existing artifact links for the item", async () => {
    const { fn } = buildArtifactLinksFetchMock([{ id: 1, url: "https://claude.ai/artifact/abc", label: "CBA" }]);
    vi.stubGlobal("fetch", fn);

    render(<ArtifactLinksPanel itemId="item-1" />);

    await waitFor(() => expect(screen.getByRole("link", { name: /CBA/i })).toBeInTheDocument());
    expect(fn).toHaveBeenCalledWith("/api/items/item-1/artifact-links");
  });

  it("shows an empty state when the item has no artifact links", async () => {
    const { fn } = buildArtifactLinksFetchMock([]);
    vi.stubGlobal("fetch", fn);

    render(<ArtifactLinksPanel itemId="item-1" />);

    await waitFor(() => expect(screen.getByText(/no artifact links yet/i)).toBeInTheDocument());
  });

  it("adds a new artifact link and re-fetches the list", async () => {
    const { fn, calls } = buildArtifactLinksFetchMock([]);
    vi.stubGlobal("fetch", fn);

    render(<ArtifactLinksPanel itemId="item-1" />);
    await waitFor(() => expect(screen.getByText(/no artifact links yet/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/artifact url/i), { target: { value: "https://claude.ai/artifact/xyz" } });
    fireEvent.change(screen.getByLabelText(/label \(optional\)/i), { target: { value: "New design" } });
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));

    await waitFor(() => expect(screen.getByRole("link", { name: /New design/i })).toBeInTheDocument());

    const postCall = calls.find((c) => c.method === "POST");
    expect(postCall?.body).toEqual({ url: "https://claude.ai/artifact/xyz", label: "New design" });
  });

  it("surfaces a real error when adding a link fails", async () => {
    const { fn } = buildArtifactLinksFetchMock([], { addFails: { status: 400, error: "url is required" } });
    vi.stubGlobal("fetch", fn);

    render(<ArtifactLinksPanel itemId="item-1" />);
    await waitFor(() => expect(screen.getByText(/no artifact links yet/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/artifact url/i), { target: { value: "not-a-real-url" } });
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));

    await waitFor(() => expect(screen.getByText(/url is required/i)).toBeInTheDocument());
  });

  it("disables the add button until a URL is entered", async () => {
    const { fn } = buildArtifactLinksFetchMock([]);
    vi.stubGlobal("fetch", fn);

    render(<ArtifactLinksPanel itemId="item-1" />);
    await waitFor(() => expect(screen.getByText(/no artifact links yet/i)).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /add link/i })).toBeDisabled();
  });
});
