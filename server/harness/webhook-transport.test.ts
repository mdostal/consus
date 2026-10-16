/**
 * @vitest-environment node
 *
 * WebhookHarnessTransport against a real local HTTP receiver — no fetch
 * mocks, so the envelope on the wire is exactly what a receiver sees.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebhookHarnessTransport, transportName } from "./transport.js";

interface Received {
  method: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

const servers: Server[] = [];

afterEach(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  servers.length = 0;
});

/** Starts a receiver; `respond` decides the reply. Returns its URL and what it got. */
async function receiver(respond: (req: IncomingMessage, res: ServerResponse) => void) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ method: req.method, contentType: req.headers["content-type"], body: JSON.parse(raw) });
      respond(req, res);
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hooks/consus`, received };
}

const PARAMS = {
  proposalId: "p-1",
  itemId: "diagram:consus",
  targetType: "diagram",
  diff: "+ added X",
  description: "add X",
  sourceRepo: "consus",
};

describe("WebhookHarnessTransport", () => {
  it("POSTs the same { method, params } envelope the stdio transport writes", async () => {
    const hook = await receiver((_req, res) => res.writeHead(202).end());
    const result = await new WebhookHarnessTransport(hook.url).invoke("proposeChange", PARAMS);

    expect(result).toEqual({ ok: true, result: null });
    expect(hook.received).toEqual([
      { method: "POST", contentType: "application/json", body: { method: "proposeChange", params: PARAMS } },
    ]);
  });

  it("returns a JSON 2xx body as the dispatch result (ticket_id passes through)", async () => {
    const hook = await receiver((_req, res) =>
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ticket_id: "T-9" })),
    );
    const result = await new WebhookHarnessTransport(hook.url).invoke("proposeChange", PARAMS);
    expect(result).toEqual({ ok: true, result: { ticket_id: "T-9" } });
  });

  it("treats a non-JSON 2xx body as accepted with a null result", async () => {
    const hook = await receiver((_req, res) => res.writeHead(200).end("ok"));
    const result = await new WebhookHarnessTransport(hook.url).invoke("proposeChange", PARAMS);
    expect(result).toEqual({ ok: true, result: null });
  });

  it("a 5xx is a recoverable delivery failure carrying the status and body", async () => {
    const hook = await receiver((_req, res) => res.writeHead(502).end("bad gateway"));
    const result = await new WebhookHarnessTransport(hook.url).invoke("proposeChange", PARAMS);
    expect(result).toEqual({ ok: false, recoverable: true, code: "INTERNAL_ERROR", message: "HTTP 502: bad gateway" });
  });

  it("maps 401/403 to AUTH_FAILURE and 429 to RATE_LIMIT", async () => {
    const statuses = [401, 403, 429, 400];
    const hook = await receiver((_req, res) => res.writeHead(statuses[hook.received.length - 1]).end());
    const transport = new WebhookHarnessTransport(hook.url);
    const codes = [];
    for (const _ of statuses) {
      const r = await transport.invoke("proposeChange", PARAMS);
      codes.push(r.ok ? "ok" : `${r.code}/${r.recoverable}`);
    }
    expect(codes).toEqual(["AUTH_FAILURE/false", "AUTH_FAILURE/false", "RATE_LIMIT/true", "INTERNAL_ERROR/false"]);
  });

  it("makes exactly one attempt — no retry on failure", async () => {
    const hook = await receiver((_req, res) => res.writeHead(503).end());
    await new WebhookHarnessTransport(hook.url).invoke("proposeChange", PARAMS);
    await new Promise((r) => setTimeout(r, 50));
    expect(hook.received).toHaveLength(1);
  });

  it("times out a receiver that never answers", async () => {
    const hook = await receiver(() => {
      /* never respond */
    });
    const result = await new WebhookHarnessTransport(hook.url, { timeoutMs: 100 }).invoke("proposeChange", PARAMS);
    expect(result).toMatchObject({ ok: false, recoverable: true, code: "TIMEOUT" });
  });

  it("a connection error is a recoverable INTERNAL_ERROR", async () => {
    const hook = await receiver((_req, res) => res.end());
    const closedUrl = hook.url;
    for (const s of servers) await new Promise((r) => s.close(r));
    servers.length = 0;

    const result = await new WebhookHarnessTransport(closedUrl).invoke("proposeChange", PARAMS);
    expect(result).toMatchObject({ ok: false, recoverable: true, code: "INTERNAL_ERROR" });
  });

  it("reports itself as the 'webhook' transport", () => {
    expect(transportName(new WebhookHarnessTransport("http://127.0.0.1:1/"))).toBe("webhook");
  });
});
