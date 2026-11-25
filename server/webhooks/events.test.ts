/**
 * @vitest-environment node
 *
 * postEvent against a real local HTTP receiver — no fetch mocks, so the body
 * on the wire is exactly what a receiver sees.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eventsWebhookUrlFromEnv, postEvent, type ConsusEvent } from "./events.js";

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
  const received: Array<{ method: string | undefined; url: string | undefined; contentType: string | undefined; body: unknown }> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, contentType: req.headers["content-type"], body: JSON.parse(raw) });
      respond(req, res);
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hooks/consus?origin=consus`, received };
}

const EVENT: ConsusEvent = {
  type: "consus.question.answered",
  version: 1,
  ticketId: "T-1",
  qid: "q1",
  answer: "A",
  actor: "Mathew",
};

describe("postEvent", () => {
  it("POSTs the event as the JSON body to the configured URL, query string included", async () => {
    const hook = await receiver((_req, res) => res.writeHead(202).end());
    expect(await postEvent(EVENT, { webhookUrl: hook.url })).toEqual({ ok: true });
    expect(hook.received).toEqual([
      { method: "POST", url: "/hooks/consus?origin=consus", contentType: "application/json", body: EVENT },
    ]);
  });

  it("a non-2xx is a failure carrying the status and body", async () => {
    const hook = await receiver((_req, res) => res.writeHead(409).end("already submitted"));
    expect(await postEvent(EVENT, { webhookUrl: hook.url })).toEqual({ ok: false, error: "HTTP 409: already submitted" });
  });

  it("makes exactly one attempt — no retry on failure", async () => {
    const hook = await receiver((_req, res) => res.writeHead(503).end());
    await postEvent(EVENT, { webhookUrl: hook.url });
    await new Promise((r) => setTimeout(r, 50));
    expect(hook.received).toHaveLength(1);
  });

  it("times out a receiver that never answers", async () => {
    const hook = await receiver(() => {
      /* never respond */
    });
    expect(await postEvent(EVENT, { webhookUrl: hook.url, timeoutMs: 100 })).toEqual({
      ok: false,
      error: `webhook did not respond: ${hook.url}`,
    });
  });

  it("a connection error is a failure, never a throw", async () => {
    const hook = await receiver((_req, res) => res.end());
    for (const s of servers) await new Promise((r) => s.close(r));
    servers.length = 0;
    expect(await postEvent(EVENT, { webhookUrl: hook.url })).toMatchObject({ ok: false });
  });
});

describe("eventsWebhookUrlFromEnv", () => {
  it("is undefined when unset or blank, the trimmed URL when set, and throws on a malformed one", () => {
    expect(eventsWebhookUrlFromEnv({})).toBeUndefined();
    expect(eventsWebhookUrlFromEnv({ CONSUS_EVENTS_WEBHOOK_URL: "  " })).toBeUndefined();
    expect(eventsWebhookUrlFromEnv({ CONSUS_EVENTS_WEBHOOK_URL: " http://hook/x " })).toBe("http://hook/x");
    expect(() => eventsWebhookUrlFromEnv({ CONSUS_EVENTS_WEBHOOK_URL: "not a url" })).toThrow(/not a valid URL/);
  });
});
