/**
 * Multica Client — mixed transport. writeComment() is REST against
 * Multica's self-hosted API server (`multica setup self-host --server-url
 * ... --app-url ...`, per ~/Code/multica/CLI_AND_DAEMON.md); listIssues()
 * shells out to the `multica` CLI (see listIssues' own doc comment for why).
 *
 * RISK (flagged in architecture.md, still open — out of this story's
 * scope): the exact comment/decision REST payload shape in writeComment()
 * below is an assumed minimal contract (POST /comments -> {id}), not yet
 * verified against Multica's real API. A short spike should confirm this
 * before REQ-07 is considered done — see architecture.md Risks.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

const DEFAULT_MULTICA_CONFIG_PATH = path.join(os.homedir(), ".multica", "config.json");

function readMulticaConfigField(field: "server_url" | "workspace_id", configPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** MULTICA_SERVER_URL env, else `server_url` from ~/.multica/config.json (the
 *  same file the `multica` CLI itself writes on `multica setup`). */
export function resolveMulticaServerUrl(
  env: NodeJS.ProcessEnv = process.env,
  configPath: string = DEFAULT_MULTICA_CONFIG_PATH,
): string {
  if (env.MULTICA_SERVER_URL && env.MULTICA_SERVER_URL.trim()) return env.MULTICA_SERVER_URL.trim();
  const fromConfig = readMulticaConfigField("server_url", configPath);
  if (fromConfig) return fromConfig;
  throw new Error(
    "Multica: no server URL found. Set MULTICA_SERVER_URL or provide ~/.multica/config.json's server_url",
  );
}

/** MULTICA_WORKSPACE_ID env, else `workspace_id` from ~/.multica/config.json. */
export function resolveMulticaWorkspaceId(
  env: NodeJS.ProcessEnv = process.env,
  configPath: string = DEFAULT_MULTICA_CONFIG_PATH,
): string {
  if (env.MULTICA_WORKSPACE_ID && env.MULTICA_WORKSPACE_ID.trim()) return env.MULTICA_WORKSPACE_ID.trim();
  const fromConfig = readMulticaConfigField("workspace_id", configPath);
  if (fromConfig) return fromConfig;
  throw new Error(
    "Multica: no workspace id found. Set MULTICA_WORKSPACE_ID or provide ~/.multica/config.json's workspace_id",
  );
}

/**
 * MULTICA_PROJECT_ID env only — no config-file fallback, since a Multica
 * workspace has many projects across many gods and there's no single
 * project every deployment should default to. Undefined means "sync the
 * whole workspace" (see listIssues' `project` option). Operators scoping a
 * single-repo Consus install to one Multica project (the common case) set
 * this explicitly — `multica project list` shows available project ids.
 */
export function resolveMulticaProjectId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.MULTICA_PROJECT_ID && env.MULTICA_PROJECT_ID.trim() ? env.MULTICA_PROJECT_ID.trim() : undefined;
}

export type ExecImpl = (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface MulticaClientOptions {
  serverUrl: string;
  workspaceId: string;
  token?: string;
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to a real child_process execFile. */
  execImpl?: ExecImpl;
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
 * the fields the classifier + ingest path need are carried — see
 * classifyDecisionType/heuristicTriageBucket in decision-contract.
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
  parentId: string | null;
}

export interface ListIssuesInput {
  status?: string;
  /** total issues to collect across pages. */
  limit?: number;
  /** Multica project UUID to scope the sync to (see `multica project list`).
   *  Omit to read across the whole workspace. */
  project?: string;
}

export type MulticaListResult =
  | { ok: true; issues: MulticaIssue[] }
  | { ok: false; error: string };

export interface MulticaClient {
  writeComment(input: WriteCommentInput): Promise<MulticaWriteResult>;
  listIssues(input?: ListIssuesInput): Promise<MulticaListResult>;
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

/** Unwrap the API's `{ issues: [...] }` / `{ data: [...] }` envelope, or a bare array. */
function unwrapIssues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const candidate = value.issues ?? value.data ?? value.items;
  return Array.isArray(candidate) ? candidate : [];
}

const defaultExecImpl: ExecImpl = promisify(execFile);

export class HttpMulticaClient implements MulticaClient {
  private readonly serverUrl: string;
  private readonly workspaceId: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly execImpl: ExecImpl;
  private readonly timeoutMs: number;

  constructor({ serverUrl, workspaceId, token, fetchImpl, execImpl, timeoutMs = 20_000 }: MulticaClientOptions) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.workspaceId = workspaceId;
    this.token = token ?? resolveMulticaToken();
    this.fetchImpl = fetchImpl ?? fetch;
    this.execImpl = execImpl ?? defaultExecImpl;
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

  /** A single CLI page. */
  private static readonly PAGE_SIZE = 100;
  /** Batch-fetch cap this story's acceptance criteria (~200 issues) preserves. */
  private static readonly DEFAULT_LIMIT = 200;
  /** Hard stop so a broken offset/pagination response can't loop forever. */
  private static readonly MAX_PAGES = 25;

  /**
   * Reads issues via the `multica` CLI (`issue list --output json`), NOT the
   * REST API writeComment() uses. Confirmed live against a real workspace
   * during this story: `${serverUrl}/issues` 404s — there is no documented
   * REST list endpoint, only the CLI's own supported surface. The CLI is
   * already the verified, versioned integration point (see
   * `multica issue list --help`); shelling out to it here avoids
   * reverse-engineering an internal API that isn't meant for external
   * clients. writeComment()'s REST path is untouched — it's a separate,
   * already-flagged risk (see file header), not this story's scope.
   */
  async listIssues({ status, limit = HttpMulticaClient.DEFAULT_LIMIT, project }: ListIssuesInput = {}): Promise<
    MulticaListResult
  > {
    const collected: MulticaIssue[] = [];
    let offset = 0;

    try {
      for (let page = 0; page < HttpMulticaClient.MAX_PAGES && collected.length < limit; page += 1) {
        const pageLimit = Math.min(HttpMulticaClient.PAGE_SIZE, limit - collected.length);
        const args = ["issue", "list", "--output", "json", "--limit", String(pageLimit), "--offset", String(offset)];
        if (status) args.push("--status", status);
        if (project) args.push("--project", project);

        const { stdout } = await this.execImpl("multica", args);
        const parsed = JSON.parse(stdout) as unknown;
        const raw = unwrapIssues(parsed);
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
}
