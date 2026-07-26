/**
 * Multica Client — REST + WebSocket client against Multica's self-hosted
 * API server (`multica setup self-host --server-url ... --app-url ...`,
 * per ~/Code/multica/CLI_AND_DAEMON.md).
 *
 * RISK (flagged in architecture.md): the exact comment/decision REST
 * payload shape below is an assumed minimal contract (POST /comments ->
 * {id}), not yet verified against Multica's real API beyond its README/CLI
 * docs. A short spike against a live Multica instance should confirm this
 * before REQ-07 is considered done — see architecture.md Risks.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TOKEN_CANDIDATE_PATHS = [
  path.join(os.homedir(), ".config", "dostal", "mtok"),
  path.join(os.homedir(), ".multica", "config.json"),
];

/**
 * REQ-24: token resolution ported from mdostal/delphi's server/multica.mjs —
 * MULTICA_TOKEN env, then a plaintext token file, then a JSON config file's
 * `.token` field. Candidate paths and env are injectable so tests never
 * touch the real filesystem or environment.
 */
export function resolveMulticaToken(
  env: NodeJS.ProcessEnv = process.env,
  candidatePaths: string[] = DEFAULT_TOKEN_CANDIDATE_PATHS,
): string {
  if (env.MULTICA_TOKEN && env.MULTICA_TOKEN.trim()) {
    return env.MULTICA_TOKEN.trim();
  }

  for (const candidate of candidatePaths) {
    try {
      const raw = readFileSync(candidate, "utf-8");
      if (candidate.endsWith(".json")) {
        const parsed = JSON.parse(raw) as { token?: string };
        if (parsed.token) return parsed.token;
      } else if (raw.trim()) {
        return raw.trim();
      }
    } catch {
      // try the next candidate
    }
  }

  throw new Error(
    "Multica: no auth token found. Set MULTICA_TOKEN or provide ~/.config/dostal/mtok or ~/.multica/config.json",
  );
}

export interface MulticaClientOptions {
  serverUrl: string;
  workspaceId: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface WriteCommentInput {
  itemId: string;
  author: string;
  body: string;
}

export type MulticaWriteResult =
  | { ok: true; multicaCommentId: string }
  | { ok: false; error: string };

export interface MulticaClient {
  writeComment(input: WriteCommentInput): Promise<MulticaWriteResult>;
}

export class HttpMulticaClient implements MulticaClient {
  private readonly serverUrl: string;
  private readonly workspaceId: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor({ serverUrl, workspaceId, token, fetchImpl, timeoutMs = 20_000 }: MulticaClientOptions) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.workspaceId = workspaceId;
    this.token = token ?? resolveMulticaToken();
    this.fetchImpl = fetchImpl ?? fetch;
    this.timeoutMs = timeoutMs;
  }

  async writeComment({ itemId, author, body }: WriteCommentInput): Promise<MulticaWriteResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await this.fetchImpl(`${this.serverUrl}/comments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
          "x-workspace-id": this.workspaceId,
        },
        body: JSON.stringify({ item_id: itemId, author, body }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        return { ok: false, error: `Multica returned HTTP ${response.status}` };
      }

      const data = (await response.json()) as { id: string };
      return { ok: true, multicaCommentId: data.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
}
