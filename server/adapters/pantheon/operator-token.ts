import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { OutboundHeaderProvider } from "../../webhooks/outbound-headers.js";

/**
 * Pantheon's operator token on Consus's outbound webhooks (mdostal/consus#213,
 * pantheon-v2 PANT-1076).
 *
 * Pantheon core-api checks a token on every mutating /api call
 * (core/api/middleware/operator-token.ts): `warn` logs a missing one,
 * `enforce` answers 401. Two of the URLs Consus posts to on hive —
 * /api/feed/changes/webhook (every proposeChange) and
 * /api/feed/events/webhook (every answer, verdict and needs-context) — are
 * guarded, so without the token an answer is accepted here and never reaches
 * the board.
 *
 * This is an OutboundHeaderProvider (server/webhooks/outbound-headers.ts): the
 * generic webhook senders don't change, and the token only goes to URLs on
 * PANTHEON_API_URL's origin, never to some other configured receiver.
 *
 * The token is resolved the way Auriga, Janus and pantheon-app resolve it:
 * POST /api/secrets/inject (exempt from the guard, so a caller can fetch the
 * token it can't yet present) writes it to a fresh file on the shared
 * `pantheon-secrets` volume; this reads `PANTHEON_OPERATOR_TOKEN=...` out of
 * it and deletes the file. The token is held in memory only and never logged.
 * It is re-resolved at most once per refresh interval, on demand (no timer),
 * so a rotation is picked up without an inject per request; a failed refresh
 * keeps the last token that worked. When none resolves the request goes out
 * without it and core-api's mode decides; the reason is logged once per miss.
 *
 * Two tokens, two jobs (pantheon-v2 first-cut-trust t2 follow-up):
 *
 * - Outbound, toward core-api: Consus's own caller token when
 *   CONSUS_CALLER_TOKEN_TAGS is set (Pantheon: `provider=pantheon,
 *   kind=caller-token,caller=consus`, injected into Consus's own dir,
 *   PANTHEON_SECRETS_SHARED_DIR=/pantheon-secrets/consus). core-api then records
 *   every answer Consus relays as the operator's with `relayed_by: consus`.
 *   Unset, Consus sends the operator token from the shared dir, as before.
 * - Inbound, on Consus's own operator routes (server/auth/operator-routes.ts):
 *   always the operator token, never the caller token. core-api never injects
 *   the operator token into a caller's own dir, so it is looked up in
 *   CONSUS_OPERATOR_TOKEN_DIR (default: the shared /pantheon-secrets once
 *   caller tags are set, else PANTHEON_SECRETS_SHARED_DIR as before).
 *
 * With no caller tags one cached source serves both.
 *
 * Env:
 *   PANTHEON_API_URL                   core-api base URL; unset, there is no provider.
 *   PANTHEON_OPERATOR_TOKEN            explicit operator token (local dev); wins over the facade.
 *   PANTHEON_SECRETS_SHARED_DIR        where the outbound token is injected; default /pantheon-secrets.
 *   CONSUS_CALLER_TOKEN_TAGS           Portunus selector of the outbound token; unset, the operator token.
 *   CONSUS_OPERATOR_TOKEN_DIR          where the inbound operator token is injected (see above).
 *   CONSUS_OPERATOR_TOKEN_SOURCE       "pantheon" (default) or "none" (never look one up;
 *                                      guarded routes then answer 503 unless the token is explicit).
 */

export const OPERATOR_TOKEN_HEADER = "X-Pantheon-Operator-Token";
/** pantheon-v2's OPERATOR_TOKEN_TAGS. */
export const OPERATOR_TOKEN_TAGS = "provider=pantheon,kind=operator-token";
export const DEFAULT_SECRETS_SHARED_DIR = "/pantheon-secrets";
export const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
/** What pantheon-v2's config/pantheon-callers.yaml names Consus's own token. Pantheon sets it in CONSUS_CALLER_TOKEN_TAGS. */
export const CONSUS_CALLER_TOKEN_TAGS = "provider=pantheon,kind=caller-token,caller=consus";
const INJECT_TIMEOUT_MS = 5_000;
const TOKEN_ENV_KEY = "PANTHEON_OPERATOR_TOKEN";
// `k=v` pairs joined by commas, as Portunus selectors are written.
const TAGS_RE = /^[A-Za-z0-9_.-]+=[^,=\s]+(?:,[A-Za-z0-9_.-]+=[^,=\s]+)*$/;

export interface PantheonOperatorTokenOptions {
  /** core-api base URL (PANTHEON_API_URL). */
  apiUrl: string;
  /** Used as-is and never looked up when set. */
  token?: string;
  /** Portunus selector to inject; default the operator token's. */
  tags?: string;
  /** "operator" (default) or "caller": names the injected file and the log lines. */
  label?: "operator" | "caller";
  sharedSecretsDir?: string;
  refreshIntervalMs?: number;
  fetch?: typeof globalThis.fetch;
  readFile?: (path: string) => Promise<string>;
  deleteFile?: (path: string) => Promise<void>;
  generateId?: () => string;
  now?: () => number;
  log?: (line: string) => void;
}

/** Reads `KEY=value` out of a `format: "env"` inject, tolerating `export`, quotes and a trailing newline. */
export function parseEnvFile(contents: string, key: string): string | undefined {
  for (const line of contents.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== key) continue;
    return match[2].trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;
  }
  return undefined;
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** The operator token, resolved on demand and cached (see the module comment). Shared by the outbound header provider and the inbound route guard. */
export interface PantheonOperatorTokenSource {
  /** The current token, or undefined when none resolves. Never throws. */
  current(): Promise<string | undefined>;
}

export function createPantheonOperatorTokenSource(opts: PantheonOperatorTokenOptions): PantheonOperatorTokenSource {
  const apiUrl = opts.apiUrl.replace(/\/+$/, "");
  const explicit = opts.token?.trim() || undefined;
  const tags = opts.tags ?? OPERATOR_TOKEN_TAGS;
  const label = opts.label ?? "operator";
  const sharedDir = opts.sharedSecretsDir ?? DEFAULT_SECRETS_SHARED_DIR;
  const refreshIntervalMs = opts.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const read = opts.readFile ?? ((path: string) => readFile(path, "utf8"));
  const remove = opts.deleteFile ?? ((path: string) => unlink(path));
  const generateId = opts.generateId ?? randomUUID;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.warn(line));

  let token: string | undefined;
  let resolvedAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<void> | undefined;
  let missLogged = false;

  async function inject(): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
    const filePath = join(sharedDir, `consus-${label}-token-${generateId()}.env`);
    try {
      const res = await doFetch(`${apiUrl}/api/secrets/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags, target: "file", path: filePath, format: "env", key: TOKEN_ENV_KEY }),
        signal: AbortSignal.timeout(INJECT_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, reason: `secrets/inject answered HTTP ${res.status}` };
      const value = parseEnvFile(await read(filePath), TOKEN_ENV_KEY);
      if (!value) return { ok: false, reason: `secrets/inject wrote no ${TOKEN_ENV_KEY}` };
      return { ok: true, value };
    } catch (error) {
      // First line only, so a log line never carries more than the transport error.
      const message = (error instanceof Error ? error.message : String(error)).split("\n")[0];
      return { ok: false, reason: message };
    } finally {
      await remove(filePath).catch(() => {});
    }
  }

  async function refresh(): Promise<void> {
    resolvedAt = now();
    const result = await inject();
    if (result.ok) {
      if (!token || missLogged) log(`[consus] Pantheon ${label} token resolved`);
      token = result.value;
      missLogged = false;
    } else if (!missLogged) {
      missLogged = true;
      log(
        `[consus] Pantheon ${label} token unavailable (${result.reason}); ` +
          (token ? "keeping the last one that worked" : label === "caller" ? "core-api webhooks go out without it" : "operator routes answer 503 and webhooks go out without it") +
          ", retrying on a later call",
      );
    }
  }

  return {
    async current() {
      if (explicit) return explicit;
      if (now() - resolvedAt >= refreshIntervalMs) {
        inflight ??= refresh().finally(() => {
          inflight = undefined;
        });
      }
      if (inflight) await inflight;
      return token;
    },
  };
}

/** Sends `source`'s token only to URLs on `apiUrl`'s origin. */
export function operatorTokenHeaderProvider(apiUrl: string, source: PantheonOperatorTokenSource): OutboundHeaderProvider {
  const apiOrigin = originOf(apiUrl.replace(/\/+$/, ""));
  return async (url: string): Promise<Record<string, string>> => {
    if (!apiOrigin || originOf(url) !== apiOrigin) return {};
    const token = await source.current();
    return token ? { [OPERATOR_TOKEN_HEADER]: token } : {};
  };
}

export function createPantheonOperatorTokenProvider(opts: PantheonOperatorTokenOptions): OutboundHeaderProvider {
  return operatorTokenHeaderProvider(opts.apiUrl, createPantheonOperatorTokenSource(opts));
}

export interface PantheonOperatorTokenEnv {
  PANTHEON_API_URL?: string;
  PANTHEON_OPERATOR_TOKEN?: string;
  PANTHEON_SECRETS_SHARED_DIR?: string;
  CONSUS_CALLER_TOKEN_TAGS?: string;
  CONSUS_OPERATOR_TOKEN_DIR?: string;
  CONSUS_OPERATOR_TOKEN_SOURCE?: string;
}

function parseSource(env: PantheonOperatorTokenEnv): "pantheon" | "none" {
  const source = (env.CONSUS_OPERATOR_TOKEN_SOURCE?.trim() || "pantheon").toLowerCase();
  if (source !== "pantheon" && source !== "none") {
    throw new Error(`CONSUS_OPERATOR_TOKEN_SOURCE must be "pantheon" or "none", got: ${env.CONSUS_OPERATOR_TOKEN_SOURCE}`);
  }
  return source;
}

/** CONSUS_CALLER_TOKEN_TAGS, or undefined when unset. Throws on a value that isn't `k=v[,k=v...]`. */
export function callerTokenTagsFromEnv(env: PantheonOperatorTokenEnv): string | undefined {
  const tags = env.CONSUS_CALLER_TOKEN_TAGS?.trim();
  if (!tags) return undefined;
  if (!TAGS_RE.test(tags)) throw new Error(`CONSUS_CALLER_TOKEN_TAGS must be k=v pairs joined by commas, got: ${tags}`);
  return tags;
}

/** Where the outbound token is injected: PANTHEON_SECRETS_SHARED_DIR, default /pantheon-secrets. */
function outboundTokenDir(env: PantheonOperatorTokenEnv): string {
  return env.PANTHEON_SECRETS_SHARED_DIR?.trim() || DEFAULT_SECRETS_SHARED_DIR;
}

/**
 * Where the inbound operator token is injected. CONSUS_OPERATOR_TOKEN_DIR wins.
 * Otherwise, with caller tags set, the shared /pantheon-secrets
 * (PANTHEON_SECRETS_SHARED_DIR is then Consus's own dir, which never accepts
 * the operator token); without them, PANTHEON_SECRETS_SHARED_DIR as before.
 */
export function operatorTokenDirFromEnv(env: PantheonOperatorTokenEnv): string {
  const explicit = env.CONSUS_OPERATOR_TOKEN_DIR?.trim();
  if (explicit) return explicit;
  return callerTokenTagsFromEnv(env) ? DEFAULT_SECRETS_SHARED_DIR : outboundTokenDir(env);
}

/**
 * Every secrets dir Consus may hold a token in: the outbound dir, the
 * operator-token dir and /pantheon-secrets itself. No project may be, sit in,
 * or contain one, and none is ever listed (t1e-consus-project-guard).
 */
export function secretsDirsFromEnv(env: PantheonOperatorTokenEnv): string[] {
  return [...new Set([outboundTokenDir(env), operatorTokenDirFromEnv(env), DEFAULT_SECRETS_SHARED_DIR])];
}

/**
 * The operator token that guards Consus's own operator routes
 * (server/auth/operator-routes.ts), or undefined for a standalone install (no
 * PANTHEON_API_URL and no PANTHEON_OPERATOR_TOKEN), which keeps them open on
 * its loopback binding. Never the caller token.
 *
 * On whenever either is set, and CONSUS_OPERATOR_TOKEN_SOURCE does not turn
 * it off: "none" only stops the lookup, so without an explicit token every
 * guarded route answers 503 (fail closed). Throws on a malformed
 * PANTHEON_API_URL, source or CONSUS_CALLER_TOKEN_TAGS.
 */
export function pantheonOperatorTokenSourceFromEnv(env: PantheonOperatorTokenEnv): PantheonOperatorTokenSource | undefined {
  const source = parseSource(env);
  const apiUrl = env.PANTHEON_API_URL?.trim();
  const explicit = env.PANTHEON_OPERATOR_TOKEN?.trim() || undefined;
  const sharedSecretsDir = operatorTokenDirFromEnv(env);
  if (!apiUrl && !explicit) return undefined;
  if (apiUrl && !URL.canParse(apiUrl)) throw new Error(`PANTHEON_API_URL is not a valid URL: ${apiUrl}`);
  if (explicit) return { current: async () => explicit };
  if (source === "none") return { current: async () => undefined };
  return createPantheonOperatorTokenSource({ apiUrl: apiUrl!, sharedSecretsDir });
}

/**
 * The token Consus sends to core-api, or undefined (no PANTHEON_API_URL, or
 * the source is "none"). With CONSUS_CALLER_TOKEN_TAGS set, Consus's own
 * caller token, looked up in PANTHEON_SECRETS_SHARED_DIR (PANTHEON_OPERATOR_TOKEN
 * is never sent then). Unset, the operator token: `operatorSource` when given,
 * so one cached lookup serves both directions. Throws on malformed env.
 */
export function pantheonCallerTokenSourceFromEnv(
  env: PantheonOperatorTokenEnv,
  operatorSource?: PantheonOperatorTokenSource,
): PantheonOperatorTokenSource | undefined {
  const mode = parseSource(env);
  const apiUrl = env.PANTHEON_API_URL?.trim();
  const tags = callerTokenTagsFromEnv(env);
  if (mode === "none" || !apiUrl) return undefined;
  if (!URL.canParse(apiUrl)) throw new Error(`PANTHEON_API_URL is not a valid URL: ${apiUrl}`);
  if (tags) return createPantheonOperatorTokenSource({ apiUrl, tags, label: "caller", sharedSecretsDir: outboundTokenDir(env) });
  return (
    operatorSource ??
    createPantheonOperatorTokenSource({ apiUrl, token: env.PANTHEON_OPERATOR_TOKEN, sharedSecretsDir: outboundTokenDir(env) })
  );
}

/**
 * The outbound provider the environment asks for, or undefined (no
 * PANTHEON_API_URL, or the source is "none"). `outbound` is the token to send
 * (pantheonCallerTokenSourceFromEnv's, so the server shares one cached
 * lookup); omitted, it is built from `env`. Throws on malformed env.
 */
export function pantheonOperatorTokenProviderFromEnv(
  env: PantheonOperatorTokenEnv,
  outbound?: PantheonOperatorTokenSource,
): OutboundHeaderProvider | undefined {
  const source = pantheonCallerTokenSourceFromEnv(env, outbound);
  const apiUrl = env.PANTHEON_API_URL?.trim();
  if (!source || !apiUrl) return undefined;
  return operatorTokenHeaderProvider(apiUrl, outbound ?? source);
}
