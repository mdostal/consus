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

/**
 * A Multica issue, normalized from the API's snake_case wire shape. Only
 * the fields the classifier + ingest path actually need are carried —
 * see classifyDecisionType/heuristicTriageBucket in decision-contract.
 */
export interface MulticaIssue {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  labels: string[];
  updatedAt: string | null;
  createdAt: string | null;
  /** parent issue id, e.g. an epic's id for a story issue — null for a root/top-level issue. */
  parentId: string | null;
}

export interface ListIssuesInput {
  status?: string;
  /** total issues to collect across pages (Claud-ometer's DELPHI_REVIEW_LIMIT default). */
  limit?: number;
}

export type MulticaListResult =
  | { ok: true; issues: MulticaIssue[] }
  | { ok: false; error: string };

export type MulticaGetIssueResult =
  | { ok: true; issue: MulticaIssue }
  | { ok: false; error: string };

export type MulticaStatusUpdateResult =
  | { ok: true; status: string }
  | { ok: false; error: string };

export interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
}

export type MulticaCreateIssueResult =
  | { ok: true; issueId: string; issueUrl: string }
  | { ok: false; error: string };

export interface MulticaClient {
  writeComment(input: WriteCommentInput): Promise<MulticaWriteResult>;
  createIssue(input: CreateIssueInput): Promise<MulticaCreateIssueResult>;
  listIssues(input?: ListIssuesInput): Promise<MulticaListResult>;
  getIssue(key: string): Promise<MulticaGetIssueResult>;
  updateIssueStatus(issueId: string, status: string): Promise<MulticaStatusUpdateResult>;
  unblockIssue(issueId: string): Promise<MulticaStatusUpdateResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeIssue(raw: unknown): MulticaIssue | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const title = asString(raw.title);
  const status = asString(raw.status);
  if (!id || !title || !status) return null;
  const labels = Array.isArray(raw.labels)
    ? raw.labels.map((l) => (isRecord(l) ? asString(l.name) : asString(l))).filter((l): l is string => Boolean(l))
    : [];
  return {
    id,
    identifier: asString(raw.identifier),
    title,
    description: asString(raw.description),
    status,
    priority: asString(raw.priority),
    labels,
    updatedAt: asString(raw.updated_at),
    createdAt: asString(raw.created_at),
    parentId: asString(raw.parent_issue_id),
  };
}

function normalizeCreatedIssue(raw: unknown): { issueId: string; issueUrl: string } | null {
  const issue = isRecord(raw) && "issue" in raw ? raw.issue : raw;
  if (!isRecord(issue)) return null;

  const issueId = asString(issue.id);
  const issueUrl = asString(issue.issue_url) ?? asString(issue.html_url) ?? asString(issue.web_url) ?? asString(issue.url);
  if (!issueId || !issueUrl) return null;

  return { issueId, issueUrl };
}

/** Unwrap the API's `{ issues: [...] }` / `{ data: [...] }` envelope, or a bare array. */
function unwrapIssues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const candidate = value.issues ?? value.data ?? value.items;
  return Array.isArray(candidate) ? candidate : [];
}

export class HttpMulticaClient implements MulticaClient {
  /** Multica's /issues endpoint caps a single page at 100 rows (mirrors the
   *  real API's page cap per Claud-ometer's readViaApi). */
  private static readonly PAGE_SIZE = 100;
  /** Claud-ometer's DELPHI_REVIEW_LIMIT default — the batch-fetch cap this
   *  story's acceptance criteria (~200 issues) preserves. */
  private static readonly DEFAULT_LIMIT = 200;
  /** Hard stop so a broken offset/pagination response can't loop forever. */
  private static readonly MAX_PAGES = 25;

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

  async createIssue({ title, body, labels = [] }: CreateIssueInput): Promise<MulticaCreateIssueResult> {
    try {
      const response = await this.fetchJson(`${this.serverUrl}/issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description: body, labels }),
      });

      if (!response.ok) {
        return { ok: false, error: `Multica returned HTTP ${response.status}` };
      }

      const created = normalizeCreatedIssue(await response.json());
      if (!created) {
        return { ok: false, error: "Multica returned an invalid issue create payload" };
      }

      return { ok: true, issueId: created.issueId, issueUrl: created.issueUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * REQ (this story): batch-fetch issues, paginating in PAGE_SIZE chunks up
   * to `limit` (default 200, Claud-ometer's DELPHI_REVIEW_LIMIT), so the
   * ingest adapter can process a full batch without a single oversized
   * request risking a timeout. Stops early on a short (last) page.
   */
  async listIssues({ status, limit = HttpMulticaClient.DEFAULT_LIMIT }: ListIssuesInput = {}): Promise<
    MulticaListResult
  > {
    const collected: MulticaIssue[] = [];
    let offset = 0;

    try {
      for (let page = 0; page < HttpMulticaClient.MAX_PAGES && collected.length < limit; page += 1) {
        const pageLimit = Math.min(HttpMulticaClient.PAGE_SIZE, limit - collected.length);
        const url = new URL(`${this.serverUrl}/issues`);
        url.searchParams.set("limit", String(pageLimit));
        url.searchParams.set("offset", String(offset));
        if (status) url.searchParams.set("status", status);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response;
        try {
          response = await this.fetchImpl(url.toString(), {
            method: "GET",
            headers: {
              authorization: `Bearer ${this.token}`,
              "x-workspace-id": this.workspaceId,
            },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          return { ok: false, error: `Multica returned HTTP ${response.status}` };
        }

        const raw = unwrapIssues(await response.json());
        const batch = raw.map(normalizeIssue).filter((i): i is MulticaIssue => i !== null);
        collected.push(...batch);

        if (raw.length < pageLimit) break; // reached the last page
        offset += pageLimit;
      }

      return { ok: true, issues: collected.slice(0, limit) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  async getIssue(key: string): Promise<MulticaGetIssueResult> {
    try {
      const response = await this.fetchJson(`${this.serverUrl}/issues/${encodeURIComponent(key)}`, { method: "GET" });
      if (!response.ok) {
        return { ok: false, error: `Multica returned HTTP ${response.status}` };
      }

      const raw = await response.json();
      const issue = normalizeIssue(isRecord(raw) && "issue" in raw ? raw.issue : raw);
      if (!issue) {
        return { ok: false, error: "Multica returned an invalid issue payload" };
      }

      return { ok: true, issue };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  async updateIssueStatus(issueId: string, status: string): Promise<MulticaStatusUpdateResult> {
    try {
      const response = await this.fetchJson(`${this.serverUrl}/issues/${encodeURIComponent(issueId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        return { ok: false, error: `Multica returned HTTP ${response.status}` };
      }

      const raw = await response.json();
      const issue = normalizeIssue(isRecord(raw) && "issue" in raw ? raw.issue : raw);
      return { ok: true, status: issue?.status ?? status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  async unblockIssue(issueId: string): Promise<MulticaStatusUpdateResult> {
    return this.updateIssueStatus(issueId, "todo");
  }

  private async fetchJson(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${this.token}`,
          "x-workspace-id": this.workspaceId,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
