/**
 * Minerva stdio transport — deliberately mirrors Hive's existing
 * @hive/task-tracking-dispatch ABI pattern (capabilities/abi_version
 * handshake, invoke(method, params), {ok,result} / {ok:false,recoverable,code}
 * error mapping) rather than inventing a new protocol. See
 * ~/Code/plugin-hive/hive/lib/task-tracking-dispatch/README.md.
 */

export type MinervaResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; recoverable: boolean; code: MinervaErrorCode; message?: string; retry_after_ms?: number };

export type MinervaErrorCode =
  | "NOT_FOUND"
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "UNKNOWN_METHOD"
  | "OPERATION_UNSUPPORTED"
  | "TIMEOUT"
  | "NO_ADAPTER"
  | "INTERNAL_ERROR";

export interface MinervaTransport {
  invoke<T = unknown>(method: string, params?: unknown): Promise<MinervaResult<T>>;
}

/**
 * Real stdio transport (production). Spawns/connects to the Minerva
 * subprocess and speaks JSON-RPC-shaped requests over stdin/stdout, one
 * JSON object per line. Not exercised by unit tests — those inject a fake
 * MinervaTransport instead, per the adapter-dispatch pattern's own testing
 * convention (mock-adapter fixtures, no network/process in tests).
 */
export class StdioMinervaTransport implements MinervaTransport {
  constructor(private readonly command: string, private readonly args: string[] = []) {}

  async invoke<T = unknown>(method: string, params?: unknown): Promise<MinervaResult<T>> {
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
        resolve({ ok: false, recoverable: false, code: "INTERNAL_ERROR", message: "failed to spawn Minerva" });
      });
      child.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as MinervaResult<T>);
        } catch {
          resolve({ ok: false, recoverable: false, code: "INTERNAL_ERROR", message: "malformed Minerva response" });
        }
      });

      child.stdin.write(JSON.stringify({ method, params }) + "\n");
      child.stdin.end();
    });
  }
}
