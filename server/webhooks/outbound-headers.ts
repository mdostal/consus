/**
 * Extra headers for Consus's outbound webhooks (mdostal/consus#213).
 *
 * The webhook senders — the harness transport (server/harness/transport.ts),
 * the events webhook (./events.ts) and the thread webhook
 * (server/threads/notifier.ts) — stay generic: none of them knows what's on
 * the other end. Before each POST they ask the registered provider for extra
 * headers for that URL and send whatever comes back. With no provider
 * registered (the default, and every standalone install) that is nothing.
 *
 * A receiver that needs auth registers a provider at startup
 * (server/index.ts); Pantheon's is server/adapters/pantheon/operator-token.ts.
 */

/** Extra headers for one POST to `url`. May be async; a throw is treated as "no extra headers". */
export type OutboundHeaderProvider = (url: string) => Record<string, string> | Promise<Record<string, string>>;

let provider: OutboundHeaderProvider | undefined;

/** Registers the process-wide provider; `undefined` clears it. */
export function setOutboundHeaderProvider(next: OutboundHeaderProvider | undefined): void {
  provider = next;
}

/** The headers to add to a POST to `url`. Never throws: a provider failure sends the request without them. */
export async function outboundHeaders(url: string, from: OutboundHeaderProvider | undefined = provider): Promise<Record<string, string>> {
  if (!from) return {};
  try {
    return (await from(url)) ?? {};
  } catch {
    return {};
  }
}
