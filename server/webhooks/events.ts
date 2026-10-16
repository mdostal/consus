/**
 * The generic outbound event seam (PANT-998): answers, verdicts and
 * needs-context requests leave Consus as typed events POSTed to one
 * configured URL, CONSUS_EVENTS_WEBHOOK_URL. Consus knows nothing about
 * what's on the other end — the receiver maps each `type` onto its own
 * model (Pantheon core-api is one such receiver).
 *
 * Same shape as the thread webhook (server/threads/notifier.ts): a `type`
 * and `version` on every body. One attempt per POST; callers record the
 * outcome and retry by hand, never on a timer.
 *
 * Any auth the receiver needs comes from the registered OutboundHeaderProvider
 * (./outbound-headers.ts).
 */

import { outboundHeaders, type OutboundHeaderProvider } from "./outbound-headers.js";

/** A verdict on a question imported through POST /api/questions/import. */
export interface QuestionAnsweredEvent {
  type: "consus.question.answered";
  version: 1;
  /** The `ticket` the question was imported under. */
  ticketId: string;
  qid: string;
  answer: string;
  actor: string;
}

/** Every question imported under `ticketId` now has an answer. Sent once per ticket, after all its answers were accepted. */
export interface QuestionsSubmittedEvent {
  type: "consus.questions.submitted";
  version: 1;
  ticketId: string;
  actor: string;
}

/** A verdict on a decision that didn't come in through the question seam. */
export interface DecisionDecidedEvent {
  type: "consus.decision.decided";
  version: 1;
  decisionId: string;
  title: string;
  summary?: string;
  decidedAt: string;
}

/** A decision was created with no supporting material (PANT-938). Sent at most once per decision. */
export interface DecisionNeedsContextEvent {
  type: "consus.decision.needs_context";
  version: 1;
  decisionId: string;
  surveyId: string | null;
  title: string;
  sourceRepo: string | null;
  missing: string[];
}

export type ConsusEvent =
  | QuestionAnsweredEvent
  | QuestionsSubmittedEvent
  | DecisionDecidedEvent
  | DecisionNeedsContextEvent;

export interface EventsWebhookOptions {
  webhookUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Overrides the registered provider — test seam. */
  headers?: OutboundHeaderProvider;
}

/** POSTs one event. Never throws: a non-2xx, timeout or network error comes back as `{ ok: false }`. */
export async function postEvent(
  event: ConsusEvent,
  { webhookUrl, fetch: doFetch = globalThis.fetch, timeoutMs = 10_000, headers }: EventsWebhookOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const extra = await outboundHeaders(webhookUrl, headers);
  try {
    const res = await doFetch(webhookUrl, {
      method: "POST",
      headers: { ...extra, "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 500)}` : ""}` };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, error: `webhook did not respond: ${webhookUrl}` };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** CONSUS_EVENTS_WEBHOOK_URL, trimmed; undefined when unset or empty. Throws on a malformed URL. */
export function eventsWebhookUrlFromEnv(env: { CONSUS_EVENTS_WEBHOOK_URL?: string }): string | undefined {
  const url = env.CONSUS_EVENTS_WEBHOOK_URL?.trim();
  if (!url) return undefined;
  if (!URL.canParse(url)) throw new Error(`CONSUS_EVENTS_WEBHOOK_URL is not a valid URL: ${url}`);
  return url;
}

/** The URL a route falls back to when none was injected: CONSUS_EVENTS_WEBHOOK_URL, or undefined. Read per call so tests can clear it. */
export function envEventsWebhookUrl(): string | undefined {
  return process.env.CONSUS_EVENTS_WEBHOOK_URL?.trim() || undefined;
}
