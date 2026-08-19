import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AttachmentsPanel } from "./AttachmentsPanel";
import type { Attachment } from "./types";

function jsonRes(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

/** A stateful fetch mock for /api/items/:id/attachments (list+create) and
 *  /api/attachments/:id (delete), matching the real routes s1 built —
 *  same stateful-mock convention as App.test.tsx's buildDecisionsFetchMock. */
function buildAttachmentsFetchMock(initial: Attachment[], opts: { uploadFails?: { status: number; error: string } } = {}) {
  let attachments = [...initial];
  let nextId = attachments.length + 1;
  const calls: { method: string; url: string }[] = [];

  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url });

    if (method === "GET" && url === "/api/items/item-1/attachments") {
      return jsonRes(200, attachments);
    }

    if (method === "POST" && url === "/api/items/item-1/attachments") {
      if (opts.uploadFails) {
        return jsonRes(opts.uploadFails.status, { error: opts.uploadFails.error });
      }
      const formData = init?.body as FormData;
      const file = formData.get("file") as File;
      const created: Attachment = {
        id: `att-${nextId++}`,
        item_id: "item-1",
        file_name: file.name,
        mime_type: file.type,
        size: file.size,
        actor: "Mathew",
        created_at: "2026-08-12T00:00:00Z",
      };
      attachments = [...attachments, created];
      return jsonRes(201, { id: created.id, item_id: created.item_id, file_name: created.file_name, mime_type: created.mime_type, size: created.size, created_at: created.created_at });
    }

    const deleteMatch = /^\/api\/attachments\/([^/]+)$/.exec(url);
    if (method === "DELETE" && deleteMatch) {
      attachments = attachments.filter((a) => a.id !== deleteMatch[1]);
      return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
    }

    return jsonRes(404, { error: "not found" });
  });

  return { fn, calls };
}

function makeAttachment(id: string, file_name: string): Attachment {
  return {
    id,
    item_id: "item-1",
    file_name,
    mime_type: "application/pdf",
    size: 1024,
    actor: "Mathew",
    created_at: "2026-08-12T00:00:00Z",
  };
}

describe("AttachmentsPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a visible loading state while the attachment list is being fetched", async () => {
    let resolveList: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveList = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pending),
    );

    render(<AttachmentsPanel itemId="item-1" />);

    expect(screen.getByText(/loading attachments/i)).toBeInTheDocument();

    resolveList({ ok: true, status: 200, json: async () => [] });
    await waitFor(() => expect(screen.queryByText(/loading attachments/i)).not.toBeInTheDocument());
  });

  it("shows an empty/no-attachments state alongside the upload area when there are zero attachments", async () => {
    const { fn } = buildAttachmentsFetchMock([]);
    vi.stubGlobal("fetch", fn);

    render(<AttachmentsPanel itemId="item-1" />);

    expect(await screen.findByText(/no attachments yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload attachment/i })).toBeInTheDocument();
  });

  it("lists all N existing attachments (name, type, size) each with download and delete", async () => {
    const { fn } = buildAttachmentsFetchMock([makeAttachment("att-1", "one.pdf"), makeAttachment("att-2", "two.png")]);
    vi.stubGlobal("fetch", fn);

    render(<AttachmentsPanel itemId="item-1" />);

    expect(await screen.findByText("one.pdf")).toBeInTheDocument();
    expect(screen.getByText("two.png")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download one\.pdf/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete one\.pdf/i })).toBeInTheDocument();
  });

  it("uploading a file POSTs to /api/items/:id/attachments with the current actor and adds it to the list without a full page reload", async () => {
    const { fn, calls } = buildAttachmentsFetchMock([]);
    vi.stubGlobal("fetch", fn);

    render(<AttachmentsPanel itemId="item-1" />);
    await screen.findByText(/no attachments yet/i);

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const input = screen.getByLabelText(/choose a file to upload/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.queryByText(/no attachments yet/i)).not.toBeInTheDocument();

    const postCall = calls.find((c) => c.method === "POST" && c.url === "/api/items/item-1/attachments");
    expect(postCall).toBeTruthy();
    const postInit = fn.mock.calls.find(([u, i]) => u === "/api/items/item-1/attachments" && (i as RequestInit)?.method === "POST")![1] as RequestInit;
    const formData = postInit.body as FormData;
    expect(formData.get("actor")).toBe("Mathew");
  });

  it("shows a specific error and adds no phantom attachment when the server rejects the upload (400 disallowed type)", async () => {
    const { fn } = buildAttachmentsFetchMock([], { uploadFails: { status: 400, error: "File type not allowed" } });
    vi.stubGlobal("fetch", fn);

    render(<AttachmentsPanel itemId="item-1" />);
    await screen.findByText(/no attachments yet/i);

    const file = new File(["hello"], "virus.exe", { type: "application/octet-stream" });
    const input = screen.getByLabelText(/choose a file to upload/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/file type not allowed/i)).toBeInTheDocument();
    expect(screen.queryByText("virus.exe")).not.toBeInTheDocument();
    expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument();
  });

  it("shows a specific error when the server rejects the upload as too large (413)", async () => {
    const { fn } = buildAttachmentsFetchMock([], { uploadFails: { status: 413, error: "Payload Too Large" } });
    vi.stubGlobal("fetch", fn);

    render(<AttachmentsPanel itemId="item-1" />);
    await screen.findByText(/no attachments yet/i);

    const file = new File(["hello"], "big.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText(/choose a file to upload/i), { target: { files: [file] } });

    expect(await screen.findByText(/payload too large/i)).toBeInTheDocument();
    expect(screen.queryByText("big.zip")).not.toBeInTheDocument();
  });

  it("shows a specific (non-generic) error and no phantom attachment on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        if (method === "GET" && url === "/api/items/item-1/attachments") return jsonRes(200, []);
        if (method === "POST" && url === "/api/items/item-1/attachments") return Promise.reject(new Error("network error"));
        return jsonRes(404, {});
      }),
    );

    render(<AttachmentsPanel itemId="item-1" />);
    await screen.findByText(/no attachments yet/i);

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/choose a file to upload/i), { target: { files: [file] } });

    const err = await screen.findByText(/could not upload file/i);
    expect(err).toHaveTextContent(/network error/i);
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("deleting an attachment requires confirmation, then DELETEs and removes it from the list without a full page reload", async () => {
    const { fn, calls } = buildAttachmentsFetchMock([makeAttachment("att-1", "one.pdf")]);
    vi.stubGlobal("fetch", fn);

    render(<AttachmentsPanel itemId="item-1" />);
    await screen.findByText("one.pdf");

    fireEvent.click(screen.getByRole("button", { name: /delete one\.pdf/i }));
    // No DELETE fired yet — confirmation required first.
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByText("one.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

    await waitFor(() => expect(screen.queryByText("one.pdf")).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/attachments/att-1")).toBe(true);
    expect(await screen.findByText(/no attachments yet/i)).toBeInTheDocument();
  });
});
