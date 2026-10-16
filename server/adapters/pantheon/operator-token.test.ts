/**
 * @vitest-environment node
 *
 * mdostal/consus#213: Consus's webhooks to Pantheon core-api carry the
 * operator token. The end-to-end cases run a real local "core-api" that
 * implements POST /api/secrets/inject against a temp secrets dir and guards
 * its webhook routes the way core-api's `enforce` mode does — no fetch mocks.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPERATOR_TOKEN_HEADER,
  OPERATOR_TOKEN_TAGS,
  createPantheonOperatorTokenProvider,
  pantheonOperatorTokenProviderFromEnv,
  parseEnvFile,
} from "./operator-token.js";
import { outboundHeaders, setOutboundHeaderProvider } from "../../webhooks/outbound-headers.js";
import { WebhookHarnessTransport } from "../../harness/transport.js";
import { postEvent } from "../../webhooks/events.js";
import { WebhookThreadNotifier } from "../../threads/notifier.js";

const servers: Server[] = [];
let secretsDir: string;

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), "consus-secrets-"));
});

afterEach(async () => {
  setOutboundHeaderProvider(undefined);
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  servers.length = 0;
  rmSync(secretsDir, { recursive: true, force: true });
});

interface Hit {
  path: string;
  token: string | undefined;
  body: unknown;
}

/** A stand-in for core-api under `enforce`: inject writes `current.token` to the requested file; everything else needs it. */
async function fakeCoreApi(current: { token: string; injectStatus?: number }) {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      const body = raw ? JSON.parse(raw) : null;
      const token = req.headers[OPERATOR_TOKEN_HEADER.toLowerCase()] as string | undefined;
      hits.push({ path, token, body });
      if (path === "/api/secrets/inject") {
        if (current.injectStatus) return res.writeHead(current.injectStatus).end();
        writeFileSync(body.path, `${body.key}=${current.token}\n`);
        return res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      }
      if (token !== current.token) return res.writeHead(401).end("operator token required");
      res.writeHead(202).end();
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, hits };
}

const quiet = () => {};

describe("Pantheon operator token on Consus's webhooks (end to end)", () => {
  it("every guarded webhook gets through once the provider is registered — and 401s without it", async () => {
    const api = await fakeCoreApi({ token: "tok-1" });
    const changes = new WebhookHarnessTransport(`${api.url}/api/feed/changes/webhook?origin=consus`);
    const events = `${api.url}/api/feed/events/webhook?origin=consus`;
    const event = { type: "consus.questions.submitted", version: 1, ticketId: "T-1", actor: "op" } as const;

    // Today: nothing registered, so enforce rejects both.
    expect(await changes.invoke("proposeChange", { proposalId: "p-1" })).toMatchObject({ ok: false, code: "AUTH_FAILURE" });
    expect(await postEvent(event, { webhookUrl: events })).toMatchObject({ ok: false, error: expect.stringContaining("HTTP 401") });

    setOutboundHeaderProvider(createPantheonOperatorTokenProvider({ apiUrl: api.url, sharedSecretsDir: secretsDir, log: quiet }));

    expect(await changes.invoke("proposeChange", { proposalId: "p-1" })).toEqual({ ok: true, result: null });
    expect(await postEvent(event, { webhookUrl: events })).toEqual({ ok: true });
    expect(await new WebhookThreadNotifier(`${api.url}/api/consus/threads/events?token=s`).notify({} as never)).toEqual({ ok: true });

    const injects = api.hits.filter((h) => h.path === "/api/secrets/inject");
    expect(injects).toHaveLength(1); // cached across all three
    expect(injects[0].token).toBeUndefined(); // inject is the one call that can't carry it
    expect(injects[0].body).toMatchObject({ tags: OPERATOR_TOKEN_TAGS, target: "file", format: "env", key: "PANTHEON_OPERATOR_TOKEN" });
    expect(injects[0].body).toMatchObject({ path: expect.stringContaining(secretsDir) });
    expect(readdirSync(secretsDir)).toEqual([]); // the injected file is deleted
  });

  it("never sends the token to a receiver on another origin", async () => {
    const api = await fakeCoreApi({ token: "tok-1" });
    const other = await fakeCoreApi({ token: "unused" });
    setOutboundHeaderProvider(createPantheonOperatorTokenProvider({ apiUrl: api.url, sharedSecretsDir: secretsDir, log: quiet }));

    await new WebhookHarnessTransport(`${other.url}/hooks`).invoke("proposeChange", { proposalId: "p-1" });
    expect(other.hits).toEqual([expect.objectContaining({ path: "/hooks", token: undefined })]);
    expect(api.hits).toEqual([]); // and doesn't even look it up
  });
});

describe("createPantheonOperatorTokenProvider", () => {
  const URL_ON_API = "http://core-api:3012/api/feed/events/webhook?origin=consus";

  function fakeFacade(tokens: Array<string | Error | number>) {
    const calls: string[] = [];
    const files = new Map<string, string>();
    const deleted: string[] = [];
    let i = 0;
    const fetch = (async (_url: string, init: RequestInit) => {
      const next = tokens[Math.min(i++, tokens.length - 1)];
      const body = JSON.parse(String(init.body));
      calls.push(body.path);
      if (next instanceof Error) throw next;
      if (typeof next === "number") return new Response(null, { status: next });
      files.set(body.path, `PANTHEON_OPERATOR_TOKEN="${next}"\n`);
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;
    return {
      calls,
      deleted,
      opts: {
        fetch,
        readFile: async (p: string) => {
          const v = files.get(p);
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return v;
        },
        deleteFile: async (p: string) => {
          deleted.push(p);
          files.delete(p);
        },
      },
    };
  }

  it("re-resolves at most once per interval, so a rotation is picked up", async () => {
    let t = 0;
    const facade = fakeFacade(["a", "b"]);
    const provider = createPantheonOperatorTokenProvider({ apiUrl: "http://core-api:3012/", now: () => t, log: quiet, ...facade.opts });

    expect(await provider(URL_ON_API)).toEqual({ [OPERATOR_TOKEN_HEADER]: "a" });
    t = 59_999;
    expect(await provider(URL_ON_API)).toEqual({ [OPERATOR_TOKEN_HEADER]: "a" });
    expect(facade.calls).toHaveLength(1);
    t = 60_000;
    expect(await provider(URL_ON_API)).toEqual({ [OPERATOR_TOKEN_HEADER]: "b" });
    expect(facade.calls).toHaveLength(2);
    expect(facade.deleted).toEqual(facade.calls);
  });

  it("concurrent webhooks share one inject", async () => {
    const facade = fakeFacade(["a"]);
    const provider = createPantheonOperatorTokenProvider({ apiUrl: "http://core-api:3012", log: quiet, ...facade.opts });
    const results = await Promise.all([provider(URL_ON_API), provider(URL_ON_API), provider(URL_ON_API)]);
    expect(results).toEqual(Array(3).fill({ [OPERATOR_TOKEN_HEADER]: "a" }));
    expect(facade.calls).toHaveLength(1);
  });

  it("a failed refresh keeps the last token that worked", async () => {
    let t = 0;
    const facade = fakeFacade(["a", 503]);
    const provider = createPantheonOperatorTokenProvider({ apiUrl: "http://core-api:3012", now: () => t, log: quiet, ...facade.opts });
    await provider(URL_ON_API);
    t = 60_000;
    expect(await provider(URL_ON_API)).toEqual({ [OPERATOR_TOKEN_HEADER]: "a" });
  });

  it("with no token it sends none, logs the miss once (never the token), and retries after the interval", async () => {
    let t = 0;
    const lines: string[] = [];
    const facade = fakeFacade([new Error("connect ECONNREFUSED\nstack..."), 500, "secret-tok"]);
    const provider = createPantheonOperatorTokenProvider({ apiUrl: "http://core-api:3012", now: () => t, log: (l) => lines.push(l), ...facade.opts });

    expect(await provider(URL_ON_API)).toEqual({});
    expect(await provider(URL_ON_API)).toEqual({}); // inside the interval: no second inject
    expect(facade.calls).toHaveLength(1);
    t = 60_000;
    expect(await provider(URL_ON_API)).toEqual({});
    expect(lines).toEqual([expect.stringContaining("unavailable (connect ECONNREFUSED)")]);
    t = 120_000;
    expect(await provider(URL_ON_API)).toEqual({ [OPERATOR_TOKEN_HEADER]: "secret-tok" });
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain("secret-tok");
    expect(facade.deleted).toEqual(facade.calls); // cleaned up even on failure
  });

  it("an explicit token is used as-is and never looked up", async () => {
    const facade = fakeFacade(["from-facade"]);
    const provider = createPantheonOperatorTokenProvider({ apiUrl: "http://core-api:3012", token: " dev-tok ", log: quiet, ...facade.opts });
    expect(await provider(URL_ON_API)).toEqual({ [OPERATOR_TOKEN_HEADER]: "dev-tok" });
    expect(await provider("http://elsewhere:1/x")).toEqual({});
    expect(facade.calls).toEqual([]);
  });
});

describe("pantheonOperatorTokenProviderFromEnv", () => {
  it("is off without PANTHEON_API_URL, or with CONSUS_OPERATOR_TOKEN_SOURCE=none", () => {
    expect(pantheonOperatorTokenProviderFromEnv({})).toBeUndefined();
    expect(pantheonOperatorTokenProviderFromEnv({ PANTHEON_API_URL: "  " })).toBeUndefined();
    expect(pantheonOperatorTokenProviderFromEnv({ PANTHEON_API_URL: "http://core-api:3012", CONSUS_OPERATOR_TOKEN_SOURCE: "none" })).toBeUndefined();
  });

  it("is on with PANTHEON_API_URL", async () => {
    const provider = pantheonOperatorTokenProviderFromEnv({ PANTHEON_API_URL: "http://core-api:3012", PANTHEON_OPERATOR_TOKEN: "t" });
    expect(await provider!("http://core-api:3012/api/feed/changes/webhook")).toEqual({ [OPERATOR_TOKEN_HEADER]: "t" });
  });

  it("fails at startup on a malformed URL or source", () => {
    expect(() => pantheonOperatorTokenProviderFromEnv({ PANTHEON_API_URL: "not a url" })).toThrow(/PANTHEON_API_URL/);
    expect(() => pantheonOperatorTokenProviderFromEnv({ PANTHEON_API_URL: "http://x", CONSUS_OPERATOR_TOKEN_SOURCE: "vault" })).toThrow(/CONSUS_OPERATOR_TOKEN_SOURCE/);
  });
});

describe("parseEnvFile / outboundHeaders", () => {
  it("parses KEY=value with export and quotes", () => {
    expect(parseEnvFile("OTHER=1\nexport PANTHEON_OPERATOR_TOKEN='abc'\n", "PANTHEON_OPERATOR_TOKEN")).toBe("abc");
    expect(parseEnvFile("PANTHEON_OPERATOR_TOKEN=\n", "PANTHEON_OPERATOR_TOKEN")).toBeUndefined();
  });

  it("a throwing provider means no extra headers, not a failed webhook", async () => {
    expect(await outboundHeaders("http://x", () => {
      throw new Error("boom");
    })).toEqual({});
  });
});
