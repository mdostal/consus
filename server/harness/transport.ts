/**
 * Generic agent-harness dispatch — NOT tied to any specific system (no
 * Minerva, no Multica). Consus fires a request to whatever harness is
 * configured (a CLI command, by default) and reads back a structured
 * result. This is the sole integration seam for "propose a change and let
 * a harness apply it" (server/proposals/store.ts) — Consus's core has no
 * knowledge of what's on the other end.
 */

export type HarnessResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; recoverable: boolean; code: HarnessErrorCode; message?: string; retry_after_ms?: number };

export type HarnessErrorCode =
  | "NOT_FOUND"
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "UNKNOWN_METHOD"
  | "OPERATION_UNSUPPORTED"
  | "TIMEOUT"
  | "NO_ADAPTER"
  | "INTERNAL_ERROR";

export interface HarnessTransport {
  invoke<T = unknown>(method: string, params?: unknown): Promise<HarnessResult<T>>;
}

/** Always resolves NO_ADAPTER — the default when no harness is configured.
 *  Never spawns a process, never assumes any specific system exists. */
export const NOOP_HARNESS_TRANSPORT: HarnessTransport = {
  async invoke() {
    return { ok: false, recoverable: false, code: "NO_ADAPTER" };
  },
};

/**
 * File-based transport (opt-in, standalone). Writes each proposeChange
 * envelope as a JSON file under `handoffsDir`; a separate `consus handoff`
 * CLI (bin/handoff.mjs) reads those files and posts results back.
 * Selected by CONSUS_HARNESS_FILE_DIR instead of CONSUS_HARNESS_COMMAND.
 */
export class FileHarnessTransport implements HarnessTransport {
  constructor(private readonly handoffsDir: string) {}

  async invoke<T = unknown>(method: string, params?: unknown): Promise<HarnessResult<T>> {
    if (method === "threadMessage") return this.writeThreadMessage<T>(params);
    if (method !== "proposeChange") {
      return { ok: false, recoverable: false, code: "UNKNOWN_METHOD" };
    }
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const envelope = params as { proposalId?: string } & Record<string, unknown>;
    if (!envelope?.proposalId) {
      return { ok: false, recoverable: false, code: "INTERNAL_ERROR", message: "missing proposalId in params" };
    }

    try {
      mkdirSync(this.handoffsDir, { recursive: true });
      const filePath = join(this.handoffsDir, `${envelope.proposalId}.json`);
      writeFileSync(filePath, JSON.stringify(envelope, null, 2) + "\n", "utf8");
      return { ok: true, result: { handoffFile: filePath } as unknown as T };
    } catch (err) {
      return { ok: false, recoverable: true, code: "INTERNAL_ERROR", message: String(err) };
    }
  }

  /** PANT-962: a thread event lands as `<dir>/threads/<threadId>.<messageId>.json`
   *  for `consus-handoff threads` / `reply` (bin/handoff.mjs) to pick up. */
  private async writeThreadMessage<T>(params: unknown): Promise<HarnessResult<T>> {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const event = params as { threadId?: string; message?: { id?: number } } | undefined;
    if (!event?.threadId || event.message?.id === undefined) {
      return { ok: false, recoverable: false, code: "INTERNAL_ERROR", message: "missing threadId or message.id in params" };
    }
    try {
      const dir = join(this.handoffsDir, "threads");
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${event.threadId}.${event.message.id}.json`);
      writeFileSync(filePath, JSON.stringify(event, null, 2) + "\n", "utf8");
      return { ok: true, result: { handoffFile: filePath } as unknown as T };
    } catch (err) {
      return { ok: false, recoverable: true, code: "INTERNAL_ERROR", message: String(err) };
    }
  }
}

/**
 * Generic webhook transport (opt-in). POSTs the same `{ method, params }`
 * envelope the stdio transport writes to its child's stdin to a configured
 * URL — no knowledge of what's on the other end (Pantheon or anything
 * else). One attempt per dispatch: a non-2xx, a timeout, or a network error
 * comes back as a failed HarnessResult, which proposeChange records on the
 * proposal as a delivery failure; POST /api/proposals/:id/redeliver is the
 * manual retry. Results come back through POST /api/proposals/:id/result.
 * Selected by CONSUS_HARNESS=webhook + CONSUS_HARNESS_WEBHOOK_URL.
 */
export class WebhookHarnessTransport implements HarnessTransport {
  constructor(
    private readonly url: string,
    private readonly opts: { timeoutMs?: number; fetch?: typeof globalThis.fetch } = {},
  ) {}

  async invoke<T = unknown>(method: string, params?: unknown): Promise<HarnessResult<T>> {
    const doFetch = this.opts.fetch ?? globalThis.fetch;
    let res: Response;
    try {
      res = await doFetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return { ok: false, recoverable: true, code: "TIMEOUT", message: `webhook did not respond: ${this.url}` };
      }
      return {
        ok: false,
        recoverable: true,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        recoverable: res.status >= 500 || res.status === 429,
        code: res.status === 401 || res.status === 403 ? "AUTH_FAILURE" : res.status === 429 ? "RATE_LIMIT" : "INTERNAL_ERROR",
        message: `HTTP ${res.status}${text ? `: ${text.slice(0, 500)}` : ""}`,
      };
    }
    // A 2xx body is optional; when it's JSON it becomes the dispatch result
    // (proposeChange keeps a `ticket_id` field as harness_ticket_id).
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { ok: true, result: body as T };
  }
}

/**
 * Real stdio transport (opt-in, production). Spawns whatever command is
 * configured and speaks one JSON object per line over stdin/stdout. Not
 * exercised by unit tests — those inject a fake HarnessTransport instead.
 */
export class StdioHarnessTransport implements HarnessTransport {
  constructor(private readonly command: string, private readonly args: string[] = []) {}

  async invoke<T = unknown>(method: string, params?: unknown): Promise<HarnessResult<T>> {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve) => {
      const child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        resolve({ ok: false, recoverable: false, code: "TIMEOUT" });
      }, 30_000);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, recoverable: false, code: "INTERNAL_ERROR", message: "failed to spawn harness command" });
      });
      child.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as HarnessResult<T>);
        } catch {
          resolve({ ok: false, recoverable: false, code: "INTERNAL_ERROR", message: "malformed harness response" });
        }
      });

      child.stdin.write(JSON.stringify({ method, params }) + "\n");
      child.stdin.end();
    });
  }
}

export type TransportName = "webhook" | "file" | "stdio" | "noop" | "custom";

/** Human-readable name of the active transport, reported by /health and
 *  GET /api/metrics. "custom" covers injected transports (tests, embedders). */
export function transportName(transport: HarnessTransport): TransportName {
  if (transport === NOOP_HARNESS_TRANSPORT) return "noop";
  if (transport instanceof WebhookHarnessTransport) return "webhook";
  if (transport instanceof FileHarnessTransport) return "file";
  if (transport instanceof StdioHarnessTransport) return "stdio";
  return "custom";
}
