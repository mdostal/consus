export type WorkflowType = "planning" | "kickoff" | "execute";

export interface ParkedState {
  workflow_type: WorkflowType;
  context: {
    epic_id?: string;
    requirement?: string;
    [key: string]: unknown;
  };
}

export interface ParkWorkflowOptions {
  consusUrl?: string;
  fetch?: FetchLike;
}

export interface WaitForResumeOptions extends ParkWorkflowOptions {
  maxWaitMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxConsecutiveFailures?: number;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
}

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

interface ParkResponse {
  park_id?: unknown;
}

interface WorkflowStatusResponse {
  status?: unknown;
  answer?: unknown;
}

const DEFAULT_CONSUS_URL = "http://localhost:8722";
const DEFAULT_MAX_WAIT_MS = 600_000;
const DEFAULT_INITIAL_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

function resolveConsusUrl(consusUrl?: string): string {
  const url = consusUrl ?? process.env.CONSUS_URL ?? process.env.CONSUS_BASE_URL ?? DEFAULT_CONSUS_URL;
  return url.replace(/\/+$/, "");
}

function resolveFetch(fetcher?: FetchLike): FetchLike {
  const resolved = fetcher ?? globalThis.fetch;
  if (!resolved) {
    throw new Error("No fetch implementation available for Minerva park workflow calls");
  }
  return resolved as FetchLike;
}

async function parseJson(response: FetchResponse, endpoint: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Malformed JSON from ${endpoint}: ${message}`);
  }
}

function httpError(response: FetchResponse, endpoint: string): Error {
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  return new Error(`Consus ${endpoint} request failed with HTTP ${response.status}${statusText}`);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function parkWorkflow(
  questionText: string,
  state: ParkedState,
  options: ParkWorkflowOptions = {},
): Promise<string> {
  const consusUrl = resolveConsusUrl(options.consusUrl);
  const endpoint = "/api/workflows/park";
  const response = await resolveFetch(options.fetch)(`${consusUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_name: "minerva",
      workflow_type: state.workflow_type,
      parked_state: JSON.stringify(state),
      question_text: questionText,
    }),
  });

  if (!response.ok) {
    throw httpError(response, endpoint);
  }

  const data = (await parseJson(response, endpoint)) as ParkResponse;
  if (typeof data.park_id !== "string" || data.park_id.length === 0) {
    throw new Error("Consus park workflow response did not include park_id");
  }

  return data.park_id;
}

export async function waitForResume(parkId: string, options: WaitForResumeOptions = {}): Promise<string> {
  const consusUrl = resolveConsusUrl(options.consusUrl);
  const fetcher = resolveFetch(options.fetch);
  const sleepFn = options.sleep ?? sleep;
  const now = options.now ?? Date.now;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  let delayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  let consecutiveFailures = 0;
  const startTime = now();
  const endpoint = `/api/workflows/${encodeURIComponent(parkId)}/status`;

  while (now() - startTime < maxWaitMs) {
    try {
      const response = await fetcher(`${consusUrl}${endpoint}`);
      if (!response.ok) {
        throw httpError(response, endpoint);
      }

      const data = (await parseJson(response, endpoint)) as WorkflowStatusResponse;
      consecutiveFailures = 0;
      if (data.status === "resumed" && typeof data.answer === "string") {
        return data.answer;
      }
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed waiting for resume on workflow ${parkId}: ${message}`);
      }
    }

    const remainingMs = maxWaitMs - (now() - startTime);
    if (remainingMs <= 0) break;
    await sleepFn(Math.min(delayMs, remainingMs));
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }

  throw new Error(`Timeout waiting for resume on workflow ${parkId}`);
}
