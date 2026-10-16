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
 * Env:
 *   PANTHEON_API_URL                   core-api base URL; unset, there is no provider.
 *   PANTHEON_OPERATOR_TOKEN            explicit token (local dev); wins over the facade.
 *   PANTHEON_SECRETS_SHARED_DIR        shared secrets volume; default /pantheon-secrets.
 *   CONSUS_OPERATOR_TOKEN_SOURCE       "pantheon" (default) or "none" (never send one).
 */

export const OPERATOR_TOKEN_HEADER = "X-Pantheon-Operator-Token";
/** pantheon-v2's OPERATOR_TOKEN_TAGS. */
export const OPERATOR_TOKEN_TAGS = "provider=pantheon,kind=operator-token";
export const DEFAULT_SECRETS_SHARED_DIR = "/pantheon-secrets";
export const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const INJECT_TIMEOUT_MS = 5_000;
const TOKEN_ENV_KEY = "PANTHEON_OPERATOR_TOKEN";

export interface PantheonOperatorTokenOptions {
  /** core-api base URL (PANTHEON_API_URL). */
  apiUrl: string;
  /** Used as-is and never looked up when set. */
  token?: string;
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

export function createPantheonOperatorTokenProvider(opts: PantheonOperatorTokenOptions): OutboundHeaderProvider {
  const apiUrl = opts.apiUrl.replace(/\/+$/, "");
  const apiOrigin = originOf(apiUrl);
  const explicit = opts.token?.trim() || undefined;
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
    const filePath = join(sharedDir, `consus-operator-token-${generateId()}.env`);
    try {
      const res = await doFetch(`${apiUrl}/api/secrets/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: OPERATOR_TOKEN_TAGS, target: "file", path: filePath, format: "env", key: TOKEN_ENV_KEY }),
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
      if (!token || missLogged) log("[consus] Pantheon operator token resolved; core-api webhooks carry it");
      token = result.value;
      missLogged = false;
    } else if (!missLogged) {
      missLogged = true;
      log(
        `[consus] Pantheon operator token unavailable (${result.reason}); ` +
          (token ? "keeping the last one that worked" : "core-api webhooks go out without it") +
          ", retrying on a later webhook",
      );
    }
  }

  return async (url: string): Promise<Record<string, string>> => {
    if (!apiOrigin || originOf(url) !== apiOrigin) return {};
    if (explicit) return { [OPERATOR_TOKEN_HEADER]: explicit };
    if (now() - resolvedAt >= refreshIntervalMs) {
      inflight ??= refresh().finally(() => {
        inflight = undefined;
      });
    }
    if (inflight) await inflight;
    return token ? { [OPERATOR_TOKEN_HEADER]: token } : {};
  };
}

/** The provider the environment asks for, or undefined (no PANTHEON_API_URL, or the source is "none"). Throws on a malformed PANTHEON_API_URL or source. */
export function pantheonOperatorTokenProviderFromEnv(env: {
  PANTHEON_API_URL?: string;
  PANTHEON_OPERATOR_TOKEN?: string;
  PANTHEON_SECRETS_SHARED_DIR?: string;
  CONSUS_OPERATOR_TOKEN_SOURCE?: string;
}): OutboundHeaderProvider | undefined {
  const source = (env.CONSUS_OPERATOR_TOKEN_SOURCE?.trim() || "pantheon").toLowerCase();
  if (source !== "pantheon" && source !== "none") {
    throw new Error(`CONSUS_OPERATOR_TOKEN_SOURCE must be "pantheon" or "none", got: ${env.CONSUS_OPERATOR_TOKEN_SOURCE}`);
  }
  const apiUrl = env.PANTHEON_API_URL?.trim();
  if (source === "none" || !apiUrl) return undefined;
  if (!URL.canParse(apiUrl)) throw new Error(`PANTHEON_API_URL is not a valid URL: ${apiUrl}`);
  return createPantheonOperatorTokenProvider({
    apiUrl,
    token: env.PANTHEON_OPERATOR_TOKEN,
    sharedSecretsDir: env.PANTHEON_SECRETS_SHARED_DIR?.trim() || undefined,
  });
}
