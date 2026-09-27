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
 * Pantheon HTTP transport (opt-in). POSTs proposals to Pantheon's board
 * feed and surfaces results back via the result puller
 * (server/harness/pantheon-result-puller.ts). Selected by CONSUS_HARNESS=pantheon.
 */
export class PantheonHarnessTransport implements HarnessTransport {
  constructor(private readonly pantheonApiUrl: string) {}

  async invoke<T = unknown>(method: string, params?: unknown): Promise<HarnessResult<T>> {
    if (method !== "proposeChange") {
      return { ok: false, recoverable: false, code: "UNKNOWN_METHOD" };
    }
    const p = params as {
      proposalId: string;
      itemId: string;
      targetType: string;
      diff: string;
      description: string;
      sourceRepo?: string | null;
    };
    if (!p.sourceRepo) {
      return { ok: false, recoverable: false, code: "OPERATION_UNSUPPORTED", message: "item has no source_repo" };
    }
    try {
      const res = await fetch(`${this.pantheonApiUrl}/api/feed/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: {
            god: "consus",
            item_ref: { itemId: p.itemId, proposalId: p.proposalId, targetType: p.targetType },
          },
          target_repo: p.sourceRepo,
          diff: p.diff,
          description: p.description,
          requested_by: "consus",
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, recoverable: res.status >= 500, code: "INTERNAL_ERROR", message: text };
      }
      const body = (await res.json()) as T;
      return { ok: true, result: body };
    } catch (error) {
      return {
        ok: false,
        recoverable: true,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      };
    }
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
