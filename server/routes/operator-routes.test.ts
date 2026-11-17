/**
 * @vitest-environment node
 *
 * pantheon-v2 first-cut-trust t2 review finding 3: Pantheon records whatever
 * Consus relays as the operator's (`relayed_by: consus`), so every Consus route
 * that answers, decides, closes or relays to core-api needs the operator token
 * under Pantheon. Against the real server wiring (buildServer) and a local
 * stand-in for core-api; no fetch mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../index.js";
import { OPEN_WRITE_ROUTES, OPERATOR_ROUTES } from "../auth/operator-routes.js";
import {
  CONSUS_CALLER_TOKEN_TAGS,
  OPERATOR_TOKEN_HEADER,
  pantheonCallerTokenSourceFromEnv,
  pantheonOperatorTokenProviderFromEnv,
} from "../adapters/pantheon/operator-token.js";
import { setOutboundHeaderProvider } from "../webhooks/outbound-headers.js";
import { WebhookHarnessTransport } from "../harness/transport.js";
import { WebhookThreadNotifier } from "../threads/notifier.js";

const OPERATOR = "operator-token-for-tests";
const CALLER = "consus-caller-token-for-tests";
const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));
// Same parser as api-reference.drift.test.ts.
const ROUTE_RE = /\bapp\.(get|post|put|patch|delete)\b[\s\S]*?\(\s*["'`](\/[^"'`]*)["'`]/g;

function registeredWriteRoutes(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((f) => Array.from(readFileSync(join(ROUTES_DIR, f), "utf8").matchAll(ROUTE_RE), (m) => `${m[1].toUpperCase()} ${m[2]}`))
    .filter((r) => !r.startsWith("GET "));
}

const operatorKeys = OPERATOR_ROUTES.map((r) => `${r.method} ${r.url}`);
/** A concrete URL for a route pattern. */
const concrete = (url: string) => url.replace(/:[A-Za-z]+/g, "nope-1");

let work: string;
const servers: Server[] = [];

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "consus-oproutes-")));
});

afterEach(async () => {
  setOutboundHeaderProvider(undefined);
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  servers.length = 0;
  rmSync(work, { recursive: true, force: true });
});

function build(operatorToken?: () => Promise<string | undefined>, extra: Partial<Parameters<typeof buildServer>[0]> = {}): FastifyInstance {
  return buildServer({
    dbPath: join(work, "consus.sqlite"),
    projectsConfigPath: join(work, "consus-projects.json"),
    attachmentsDir: join(work, "attachments"),
    webRoot: join(work, "no-web"),
    protectedDirs: [join(work, "secrets")],
    operatorToken,
    ...extra,
  });
}

describe("which write routes are operator routes", () => {
  const routes = registeredWriteRoutes();

  it("finds the write routes (sanity check on the parser)", () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(routes).toContain("POST /api/decisions/:id/verdict");
  });

  it("classifies every write route in server/routes/*.ts as operator-only or open, never both", () => {
    const open = Object.keys(OPEN_WRITE_ROUTES);
    expect(routes.filter((r) => !operatorKeys.includes(r) && !open.includes(r))).toEqual([]);
    expect(operatorKeys.filter((r) => open.includes(r))).toEqual([]);
    // And neither list names a route that no longer exists.
    expect([...operatorKeys, ...open].filter((r) => !routes.includes(r))).toEqual([]);
  });

  it("covers every answer, verdict, decision, close and relay to core-api", () => {
    expect(operatorKeys).toEqual(
      expect.arrayContaining([
        "POST /api/decisions/:id/verdict",
        "POST /api/items/:id/decide",
        "POST /api/items/:id/close",
        "POST /api/questions/:ticket/close",
        "POST /api/questions/redeliver",
        "POST /api/proposals",
        "POST /api/proposals/:id/redeliver",
        "POST /api/events/:id/propose",
        "POST /api/docs/new",
        "POST /api/items/:id/import",
        "POST /api/threads",
        "POST /api/threads/:id/messages",
        "POST /api/threads/:id/redeliver",
        "POST /api/decisions",
        "POST /api/projects",
      ]),
    );
  });
});

describe("operator routes under Pantheon (operator token set)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });

  it.each(OPERATOR_ROUTES.map((r) => [`${r.method} ${r.url}`, r] as const))("%s: 401 without a token or with a wrong one", async (_name, route) => {
    app = build(async () => OPERATOR);
    const url = concrete(route.url);
    const none = await app.inject({ method: route.method, url, payload: {} });
    expect(none.statusCode).toBe(401);
    expect(none.json().error).toMatch(/X-Pantheon-Operator-Token/);
    for (const headers of [{ [OPERATOR_TOKEN_HEADER]: "wrong" }, { authorization: "Bearer wrong" }, { [OPERATOR_TOKEN_HEADER]: CALLER }]) {
      const res = await app.inject({ method: route.method, url, payload: {}, headers });
      expect(res.statusCode).toBe(401);
    }
  });

  it.each(OPERATOR_ROUTES.map((r) => [`${r.method} ${r.url}`, r] as const))("%s: the operator token gets through the guard", async (_name, route) => {
    app = build(async () => OPERATOR);
    for (const headers of [{ [OPERATOR_TOKEN_HEADER]: OPERATOR }, { authorization: `Bearer ${OPERATOR}` }]) {
      const res = await app.inject({ method: route.method, url: concrete(route.url), payload: {}, headers });
      // The handler answers (400/404/409/...), not the guard.
      expect([401, 503]).not.toContain(res.statusCode);
    }
  });

  it("503 (fail closed) when Consus can't resolve the operator token itself", async () => {
    app = build(async () => undefined);
    const res = await app.inject({ method: "POST", url: "/api/decisions/x/verdict", payload: {}, headers: { [OPERATOR_TOKEN_HEADER]: OPERATOR } });
    expect(res.statusCode).toBe(503);
  });

  it("leaves the open write routes open", async () => {
    app = build(async () => OPERATOR);
    for (const key of Object.keys(OPEN_WRITE_ROUTES)) {
      const [method, url] = key.split(" ");
      const res = await app.inject({ method: method as "POST", url: concrete(url), payload: {} });
      expect([401, 503], key).not.toContain(res.statusCode);
    }
  });
});

describe("operator routes in a standalone install (no Pantheon)", () => {
  it("are open, as before", async () => {
    const app = build(undefined);
    for (const route of OPERATOR_ROUTES) {
      const res = await app.inject({ method: route.method, url: concrete(route.url), payload: {} });
      expect([401, 503], `${route.method} ${route.url}`).not.toContain(res.statusCode);
    }
    await app.close();
  });
});

interface Hit {
  path: string;
  token: string | undefined;
  body: Record<string, unknown> | null;
}

/** core-api's stand-in: inject writes the token for the requested tags; webhooks take the caller token only. */
async function fakeCoreApi() {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      const token = req.headers[OPERATOR_TOKEN_HEADER.toLowerCase()] as string | undefined;
      hits.push({ path, token, body });
      if (path === "/api/secrets/inject") {
        const value = body?.tags === CONSUS_CALLER_TOKEN_TAGS ? CALLER : OPERATOR;
        writeFileSync(String(body?.path), `${body?.key}=${value}\n`);
        return res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      }
      if (token !== CALLER) return res.writeHead(401).end("caller token required");
      res.writeHead(202).end("{}");
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, hits };
}

async function until(check: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("an answer relayed to core-api (end to end)", () => {
  const saved = process.env.CONSUS_EVENTS_WEBHOOK_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.CONSUS_EVENTS_WEBHOOK_URL;
    else process.env.CONSUS_EVENTS_WEBHOOK_URL = saved;
  });

  it("is refused without the operator token and relayed under Consus's caller token with it", async () => {
    const api = await fakeCoreApi();
    const own = mkdtempSync(join(work, "consus-dir-"));
    process.env.CONSUS_EVENTS_WEBHOOK_URL = `${api.url}/api/feed/events/webhook?origin=consus`;
    const env = { PANTHEON_API_URL: api.url, CONSUS_CALLER_TOKEN_TAGS: CONSUS_CALLER_TOKEN_TAGS, PANTHEON_SECRETS_SHARED_DIR: own };
    setOutboundHeaderProvider(pantheonOperatorTokenProviderFromEnv(env, pantheonCallerTokenSourceFromEnv(env)));

    const app = build(async () => OPERATOR);
    const imported = await app.inject({
      method: "POST",
      url: "/api/questions/import",
      payload: { ticket_id: "T-1", questions: [{ qid: "q1", text: "Say something", kind: "free-text" }] },
    });
    expect(imported.statusCode).toBe(201);
    const itemId = (imported.json() as { item_ids: string[] }).item_ids[0];
    const verdict = { verdict: { kind: "text_response", text: "ship it" }, actor: "Mathew" };

    const refused = await app.inject({ method: "POST", url: `/api/decisions/${itemId}/verdict`, payload: verdict });
    expect(refused.statusCode).toBe(401);
    const asAgent = await app.inject({ method: "POST", url: `/api/decisions/${itemId}/verdict`, payload: verdict, headers: { [OPERATOR_TOKEN_HEADER]: CALLER } });
    expect(asAgent.statusCode).toBe(401);
    const open = (await app.inject({ method: "GET", url: "/api/decisions" })).json() as Array<{ id: string }>;
    expect(open.map((d) => d.id)).toContain(itemId); // nothing recorded
    expect(api.hits).toEqual([]); // nothing relayed

    const ok = await app.inject({ method: "POST", url: `/api/decisions/${itemId}/verdict`, payload: verdict, headers: { [OPERATOR_TOKEN_HEADER]: OPERATOR } });
    expect(ok.statusCode).toBe(200);
    await until(() => api.hits.some((h) => h.path === "/api/feed/events/webhook"));

    const inject = api.hits.find((h) => h.path === "/api/secrets/inject");
    expect(inject?.body).toMatchObject({ tags: CONSUS_CALLER_TOKEN_TAGS, path: expect.stringContaining(own) });
    const event = api.hits.find((h) => h.path === "/api/feed/events/webhook");
    expect(event?.token).toBe(CALLER); // Consus's own token outbound, never the operator's
    expect(event?.body).toMatchObject({ type: "consus.question.answered", ticketId: "T-1", qid: "q1" });
    expect(readdirSync(own)).toEqual([]); // the injected file is gone
    await app.close();
  });

  it("proposals and thread messages go out under the caller token too", async () => {
    const api = await fakeCoreApi();
    const own = mkdtempSync(join(work, "consus-dir-"));
    const env = { PANTHEON_API_URL: api.url, CONSUS_CALLER_TOKEN_TAGS: CONSUS_CALLER_TOKEN_TAGS, PANTHEON_SECRETS_SHARED_DIR: own };
    setOutboundHeaderProvider(pantheonOperatorTokenProviderFromEnv(env, pantheonCallerTokenSourceFromEnv(env)));
    expect(await new WebhookHarnessTransport(`${api.url}/api/feed/changes/webhook?origin=consus`).invoke("proposeChange", { proposalId: "p-1" })).toMatchObject({ ok: true });
    expect(await new WebhookThreadNotifier(`${api.url}/api/consus/threads/events?token=s`).notify({} as never)).toEqual({ ok: true });
    expect(api.hits.filter((h) => h.path !== "/api/secrets/inject").map((h) => h.token)).toEqual([CALLER, CALLER]);
  });
});
