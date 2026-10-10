import type { HarnessTransport } from "../harness/transport.js";
import type { ThreadMessageEvent } from "./store.js";

/**
 * Outbound side of agent threads (PANT-962): tells whoever is listening that
 * the operator posted. Generic by design — Consus knows nothing about what
 * answers. One attempt per message; the outcome is recorded on the message
 * and a failure is retried by hand (POST /api/threads/:id/redeliver), never
 * by a timer.
 */
export interface ThreadNotifier {
  /** Short label stored on the message ("webhook", "harness:file", ...). */
  readonly target: string;
  notify(event: ThreadMessageEvent): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** POSTs the event as-is (JSON body) to CONSUS_THREAD_WEBHOOK_URL. */
export class WebhookThreadNotifier implements ThreadNotifier {
  readonly target = "webhook";

  constructor(
    private readonly url: string,
    private readonly opts: { timeoutMs?: number; fetch?: typeof globalThis.fetch } = {},
  ) {}

  async notify(event: ThreadMessageEvent): Promise<{ ok: true } | { ok: false; error: string }> {
    const doFetch = this.opts.fetch ?? globalThis.fetch;
    try {
      const res = await doFetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 500)}` : ""}` };
      }
      return { ok: true };
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return { ok: false, error: `webhook did not respond: ${this.url}` };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * Standalone fallback: hands the event to the configured HarnessTransport as
 * a `threadMessage` call — the file transport writes it under
 * `<dir>/threads/`, stdio pipes it to the harness command.
 */
export class HarnessThreadNotifier implements ThreadNotifier {
  readonly target: string;

  constructor(private readonly transport: HarnessTransport, transportLabel: string) {
    this.target = `harness:${transportLabel}`;
  }

  async notify(event: ThreadMessageEvent): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await this.transport.invoke("threadMessage", event);
    if (result.ok) return { ok: true };
    if (result.code === "NO_ADAPTER") {
      return { ok: false, error: "no agent configured: set CONSUS_THREAD_WEBHOOK_URL or a harness transport" };
    }
    if (result.code === "UNKNOWN_METHOD") {
      return { ok: false, error: "the active harness transport does not take thread messages; set CONSUS_THREAD_WEBHOOK_URL" };
    }
    return { ok: false, error: result.message ? `${result.code}: ${result.message}` : result.code };
  }
}

/** CONSUS_THREAD_WEBHOOK_URL wins; otherwise thread messages go through
 *  the same harness transport proposals use. */
export function selectThreadNotifier(
  env: { CONSUS_THREAD_WEBHOOK_URL?: string },
  transport: HarnessTransport,
  transportLabel: string,
): ThreadNotifier {
  const url = env.CONSUS_THREAD_WEBHOOK_URL?.trim();
  if (url) {
    if (!URL.canParse(url)) throw new Error(`CONSUS_THREAD_WEBHOOK_URL is not a valid URL: ${url}`);
    return new WebhookThreadNotifier(url);
  }
  return new HarnessThreadNotifier(transport, transportLabel);
}
