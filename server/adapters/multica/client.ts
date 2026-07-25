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

export interface MulticaClientOptions {
  serverUrl: string;
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
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor({ serverUrl, fetchImpl, timeoutMs = 30_000 }: MulticaClientOptions) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl ?? fetch;
    this.timeoutMs = timeoutMs;
  }

  async writeComment({ itemId, author, body }: WriteCommentInput): Promise<MulticaWriteResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await this.fetchImpl(`${this.serverUrl}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
