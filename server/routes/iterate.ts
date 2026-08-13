import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { MulticaClient } from "../adapters/multica/client.js";
import { ingestMulticaIssue } from "../adapters/multica/ingest.js";
import { writeCommentAndCache } from "../adapters/multica/write-comment.js";
import { composeIterateComment, appendDecisionLog, readDecisionLog, DEFAULT_DECISION_LOG_PATH } from "../decision-log.js";

export interface IterateRoutesOptions {
  db: Database.Database;
  client: MulticaClient;
  decisionLogPath?: string;
}

interface IterateRequestBody {
  prompt?: unknown;
  agentId?: unknown;
  agentName?: unknown;
  scope?: { section?: unknown; diagram?: unknown };
  setInProgress?: unknown;
  actor?: unknown;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * REQ-16 (consus-phase4-close-the-loop): fire-agent-to-iterate. Ported from
 * mdostal/delphi's real, working implementation — reuses writeCommentAndCache
 * (REQ-07's single Multica-write path, not a second one) and s1's
 * ingestMulticaIssue so the fetched issue gets a local item row too.
 */
export function registerIterateRoutes(
  app: FastifyInstance,
  { db, client, decisionLogPath = DEFAULT_DECISION_LOG_PATH }: IterateRoutesOptions,
): void {
  app.post<{ Params: { key: string }; Body: IterateRequestBody }>(
    "/api/decisions/:key/iterate",
    async (request, reply) => {
      const body = request.body ?? {};
      const prompt = optionalString(body.prompt);
      if (!prompt) {
        return reply.code(400).send({ error: "prompt is required" });
      }

      const multicaKey = request.params.key.replace(/^multica:/, "");
      const issueResult = await client.getIssue(multicaKey);
      if (!issueResult.ok) {
        return reply.code(502).send({ error: `Multica issue fetch failed: ${issueResult.error}` });
      }
      const issue = issueResult.issue;
      const localItem = ingestMulticaIssue(db, issue);

      const agentId = optionalString(body.agentId);
      const agentName = optionalString(body.agentName);
      const agent = agentId && agentName ? { id: agentId, name: agentName } : null;
      const scope = body.scope ?? null;
      const actor = optionalString(body.actor) ?? "consus";
      const logId = `iterate-${randomUUID()}`;
      const timestamp = new Date().toISOString();

      const commentBody = composeIterateComment({
        title: issue.title,
        issueIdentifier: issue.identifier,
        issueId: issue.id,
        prompt,
        scope,
        agent,
        actor,
        logId,
        timestamp,
      });

      const commentResult = await writeCommentAndCache(db, client, {
        itemId: issue.id,
        cacheItemId: localItem.itemId,
        author: actor,
        body: commentBody,
      });
      if (!commentResult.ok) {
        return reply.code(502).send({ error: `Multica comment write failed: ${commentResult.error}` });
      }

      let statusSet: string | null = null;
      if (body.setInProgress === true) {
        const statusResult = await client.updateIssueStatus(issue.id, "in_progress");
        if (!statusResult.ok) {
          return reply.code(502).send({ error: `Multica status update failed: ${statusResult.error}` });
        }
        statusSet = statusResult.status;
      }

      const scopeForLog =
        scope && (optionalString(scope.section) || optionalString(scope.diagram))
          ? { ...(optionalString(scope.section) ? { section: optionalString(scope.section) } : {}), ...(optionalString(scope.diagram) ? { diagram: optionalString(scope.diagram) } : {}) }
          : null;

      const entry = await appendDecisionLog(decisionLogPath, {
        logId,
        timestamp,
        actor,
        issue: { id: issue.id, identifier: issue.identifier, title: issue.title },
        prompt,
        scope: scopeForLog,
        agent,
        commentId: commentResult.commentId,
        statusSet,
        previousStatus: body.setInProgress === true ? issue.status : null,
      });

      return { ok: true, log_id: entry.log_id, comment_id: entry.comment_id };
    },
  );

  app.get<{ Querystring: { limit?: string; issueId?: string } }>("/api/log", async (request) => {
    const limit = request.query.limit ? Number(request.query.limit) : undefined;
    return readDecisionLog(decisionLogPath, limit, request.query.issueId);
  });
}
