import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { ingestMulticaIssue, syncMulticaQueue } from "../adapters/multica/ingest.js";
import type { MulticaClient } from "../adapters/multica/client.js";
import { writeCommentAndCache } from "../adapters/multica/write-comment.js";
import { decideItem } from "../kb/store.js";

export interface DecisionRoutesOptions {
  db: Database.Database;
  client: MulticaClient;
  decisionLogPath?: string;
}

interface ItemRow {
  id: string;
  type: string;
  title: string;
  status: string;
  decision_payload: string | null;
  decision_type: string | null;
  triage_bucket: string | null;
}

interface IterateRequestBody {
  prompt?: unknown;
  agentId?: unknown;
  agentName?: unknown;
  scope?: {
    section?: unknown;
    diagram?: unknown;
  };
  setInProgress?: unknown;
  actor?: unknown;
}

interface ApproveRequestBody {
  actor?: string;
  details?: string;
}

interface DecisionLogEntry {
  log_id: string;
  timestamp: string;
  actor: string;
  issue: {
    id: string;
    identifier: string | null;
    title: string;
  };
  verdict: "iterate";
  prompt: string;
  scope: {
    section?: string;
    diagram?: string;
  } | null;
  agent: {
    id: string;
    name: string;
  } | null;
  comment_id: string;
  status_set: string | null;
  previous_status: string | null;
}

const DEFAULT_DECISION_LOG_PATH = path.join(".pHive", "decision-log.jsonl");

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeScope(scope: IterateRequestBody["scope"]): DecisionLogEntry["scope"] {
  if (!scope || typeof scope !== "object") return null;
  const section = optionalString(scope.section);
  const diagram = optionalString(scope.diagram);
  if (!section && !diagram) return null;
  return { ...(section ? { section } : {}), ...(diagram ? { diagram } : {}) };
}

function composeIterateComment(input: {
  title: string;
  issueIdentifier: string | null;
  issueId: string;
  prompt: string;
  scope: DecisionLogEntry["scope"];
  agent: DecisionLogEntry["agent"];
  actor: string;
  timestamp: string;
  logId: string;
}): string {
  const issueLabel = input.issueIdentifier ? `${input.issueIdentifier} (${input.issueId})` : input.issueId;
  const lines = [`## Iterate request for ${issueLabel}: ${input.title}`, ""];
  if (input.agent) {
    lines.push(`[@${input.agent.name}](mention://agent/${input.agent.id})`, "");
  }
  lines.push("Prompt:", input.prompt, "");
  if (input.scope?.section) {
    lines.push(`Scope section: ${input.scope.section}`);
  }
  if (input.scope?.diagram) {
    lines.push(`Scope diagram: ${input.scope.diagram}`);
  }
  if (input.scope) {
    lines.push("");
  }
  lines.push("Deliver as a NEW version, do not overwrite the original.", "");
  lines.push(`Requested by: ${input.actor}`, `Timestamp: ${input.timestamp}`, `Log ID: ${input.logId}`);
  return lines.join("\n");
}

async function appendDecisionLog(logPath: string, entry: DecisionLogEntry): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
}

async function readDecisionLog(logPath: string, limit: number): Promise<DecisionLogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(logPath, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return [];
    throw err;
  }

  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DecisionLogEntry)
    .reverse()
    .slice(0, limit);
}

function parseLogLimit(value: unknown): number {
  if (typeof value !== "string" || value.trim() === "") return 100;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(1000, Math.max(0, Math.floor(parsed)));
}

/**
 * REQ-28 + [wire-decisions-endpoint]: the "list open decisions" endpoint an
 * agent-harness needs. Every GET first syncs the live Multica feed (fetch +
 * classify, see adapters/multica/ingest.ts) so freshly filed/updated Multica
 * issues are reflected before the query runs, then lists every item that is
 * either a locally-authored decision_payload item (REQ-11/REQ-01 human
 * requests) or a classified Multica issue, excluding already-decided items
 * (decided_at IS NULL, the REQ-08 amnesia-fix rule). `?all=1` drops the
 * decided_at filter so a decided item — which a POST verdict
 * (POST /api/items/:id/decide) moves out of the default open queue — is
 * still reachable for audit/history views instead of vanishing.
 */
export function registerDecisionRoutes(
  app: FastifyInstance,
  { db, client, decisionLogPath = DEFAULT_DECISION_LOG_PATH }: DecisionRoutesOptions,
): void {
  app.get<{ Querystring: { all?: string } }>("/api/decisions", async (request, reply) => {
    const synced = await syncMulticaQueue(db, client);
    if (!synced.ok) {
      reply.code(503);
      return { error: `Multica fetch failed: ${synced.error}` };
    }

    const includeDecided = request.query.all === "1";
    const isDecisionItem = "(decision_payload IS NOT NULL OR id LIKE 'multica:%')";
    const sql = includeDecided
      ? `SELECT id, type, title, status, decision_payload, decision_type, triage_bucket FROM items WHERE ${isDecisionItem} ORDER BY created_at ASC`
      : `SELECT id, type, title, status, decision_payload, decision_type, triage_bucket FROM items WHERE ${isDecisionItem} AND decided_at IS NULL ORDER BY created_at ASC`;
    const rows = db.prepare(sql).all() as ItemRow[];

    return rows.map((row) => ({
      ...row,
      decision_payload: row.decision_payload ? JSON.parse(row.decision_payload) : null,
    }));
  });

  app.post<{ Params: { key: string }; Body: IterateRequestBody }>("/api/decisions/:key/iterate", async (request, reply) => {
    const body = request.body ?? {};
    if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      reply.code(400);
      return { error: "prompt is required" };
    }

    const issueResult = await client.getIssue(request.params.key.replace(/^multica:/, ""));
    if (!issueResult.ok) {
      reply.code(502);
      return { error: `Multica issue fetch failed: ${issueResult.error}` };
    }

    const issue = issueResult.issue;
    const localItem = ingestMulticaIssue(db, issue);
    const agentId = optionalString(body.agentId);
    const agentName = optionalString(body.agentName);
    const agent = agentId && agentName ? { id: agentId, name: agentName } : null;
    const scope = normalizeScope(body.scope);
    const actor = optionalString(body.actor) ?? "consus";
    const timestamp = new Date().toISOString();
    const logId = `iterate-${randomUUID()}`;
    const commentBody = composeIterateComment({
      title: issue.title,
      issueIdentifier: issue.identifier,
      issueId: issue.id,
      prompt: body.prompt,
      scope,
      agent,
      actor,
      timestamp,
      logId,
    });

    const commentResult = await writeCommentAndCache(db, client, {
      itemId: issue.id,
      cacheItemId: localItem.itemId,
      author: actor,
      body: commentBody,
    });
    if (!commentResult.ok) {
      reply.code(502);
      return { error: `Multica comment write failed: ${commentResult.error}` };
    }

    let statusSet: string | null = null;
    if (body.setInProgress === true) {
      const statusResult = await client.updateIssueStatus(issue.id, "in_progress");
      if (!statusResult.ok) {
        reply.code(502);
        return { error: `Multica status update failed: ${statusResult.error}` };
      }
      statusSet = statusResult.status;
    }

    const entry: DecisionLogEntry = {
      log_id: logId,
      timestamp,
      actor,
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
      },
      verdict: "iterate",
      prompt: body.prompt,
      scope,
      agent,
      comment_id: commentResult.commentId,
      status_set: statusSet,
      previous_status: body.setInProgress === true ? issue.status : null,
    };
    await appendDecisionLog(decisionLogPath, entry);

    return { ok: true, log_id: logId, comment_id: commentResult.commentId };
  });

  app.post<{ Params: { key: string }; Body: ApproveRequestBody }>("/api/decisions/:key/approve", async (request, reply) => {
    const multicaIssueId = request.params.key.replace(/^multica:/, "");
    const body = request.body ?? {};
    const actor = body.actor ?? "consus";
    
    // 1. Fetch issue to verify it exists and is accessible
    const issueResult = await client.getIssue(multicaIssueId);
    if (!issueResult.ok) {
      reply.code(502);
      return { error: `Multica issue fetch failed: ${issueResult.error}` };
    }

    // 2. Write audited comment
    const detailsPart = body.details ? `: ${body.details}` : "";
    const commentBody = `Decision approved${detailsPart}`;
    const commentResult = await writeCommentAndCache(db, client, {
      itemId: multicaIssueId,
      cacheItemId: request.params.key,
      author: actor,
      body: commentBody,
    });
    
    if (!commentResult.ok) {
      reply.code(502);
      return { error: `Multica comment write failed: ${commentResult.error}` };
    }

    // 3. Unblock issue (marks status as 'todo')
    const unblockResult = await client.unblockIssue(multicaIssueId);
    if (!unblockResult.ok) {
      reply.code(502);
      return { error: `Multica unblock failed: ${unblockResult.error}` };
    }

    // 4. SQLite update (marks as decided)
    try {
      decideItem(db, { itemId: request.params.key, actor, newStatus: "approved" });
    } catch (err) {
      reply.code(500);
      return { error: `Database update failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    return { ok: true, comment_id: commentResult.commentId };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/log", async (request) => {
    const limit = parseLogLimit(request.query.limit);
    return readDecisionLog(decisionLogPath, limit);
  });
}
