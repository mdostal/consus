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
