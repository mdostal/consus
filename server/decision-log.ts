import { randomUUID } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";

/**
 * REQ-16 (consus-phase4-close-the-loop): the local traceability log for
 * fire-agent-to-iterate requests. Ported from mdostal/delphi's real,
 * working server/index.mjs — one JSONL entry per iterate request, appended
 * only after the Multica comment write actually succeeds (never a
 * false-success log entry for a write that didn't happen).
 */

export interface DecisionLogEntry {
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
  scope: { section?: string; diagram?: string } | null;
  agent: { id: string; name: string } | null;
  comment_id: string;
  status_set: string | null;
  previous_status: string | null;
}

export const DEFAULT_DECISION_LOG_PATH = path.join(".pHive", "decision-log.jsonl");

export interface AppendDecisionLogInput {
  actor: string;
  issue: DecisionLogEntry["issue"];
  prompt: string;
  scope: DecisionLogEntry["scope"];
  agent: DecisionLogEntry["agent"];
  commentId: string;
  statusSet: string | null;
  previousStatus: string | null;
  /** Pre-generated so the comment body (composed before this write) and the
   *  log entry agree exactly. Generated fresh if omitted. */
  logId?: string;
  timestamp?: string;
}

export async function appendDecisionLog(
  logPath: string,
  input: AppendDecisionLogInput,
): Promise<DecisionLogEntry> {
  const entry: DecisionLogEntry = {
    log_id: input.logId ?? randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    actor: input.actor,
    issue: input.issue,
    verdict: "iterate",
    prompt: input.prompt,
    scope: input.scope,
    agent: input.agent,
    comment_id: input.commentId,
    status_set: input.statusSet,
    previous_status: input.previousStatus,
  };

  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8");
  return entry;
}

/** Most-recent-first, capped by limit (default 100, max 1000 — matches delphi's own bounds).
 *  Optionally filtered to one issue's requests (versions-view-and-trigger). */
export async function readDecisionLog(
  logPath: string,
  limit = 100,
  issueId?: string,
): Promise<DecisionLogEntry[]> {
  const cappedLimit = Math.min(Math.max(1, limit), 1000);

  let raw: string;
  try {
    raw = await readFile(logPath, "utf-8");
  } catch {
    return []; // no log file yet — not an error
  }

  const entries = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DecisionLogEntry)
    .filter((entry) => !issueId || entry.issue.id === issueId);

  return entries.reverse().slice(0, cappedLimit);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export interface ComposeIterateCommentInput {
  title: string;
  issueIdentifier: string | null;
  issueId: string;
  prompt: string;
  scope: { section?: unknown; diagram?: unknown } | null | undefined;
  agent: { id: string; name: string } | null;
  actor: string;
  logId: string;
  /** Shared with the log entry's own timestamp so the two records agree
   *  exactly. Defaults to now if omitted. */
  timestamp?: string;
}

/**
 * Composes the markdown comment body Multica dispatches on. The
 * `[@name](mention://agent/<id>)` line is what actually triggers dispatch —
 * omitted entirely (not just left agent-less) when either half is missing,
 * so a partial/ambiguous agent reference never accidentally mentions the
 * wrong agent or silently no-ops a dispatch the caller expected.
 */
export function composeIterateComment(input: ComposeIterateCommentInput): string {
  const lines: string[] = [];
  lines.push(`**Iterate request** — ${input.issueIdentifier ?? input.issueId}: ${input.title}`);

  if (input.agent) {
    lines.push(`[@${input.agent.name}](mention://agent/${input.agent.id})`);
  }

  lines.push("");
  lines.push(input.prompt);

  const section = optionalString(input.scope?.section);
  const diagram = optionalString(input.scope?.diagram);
  if (section) lines.push("", `Scope — section: ${section}`);
  if (diagram) lines.push("", `Scope — diagram: ${diagram}`);

  lines.push("", "Deliver as a NEW version — do not overwrite the original.");
  lines.push("", `— ${input.actor}, ${input.timestamp ?? new Date().toISOString()} (log ${input.logId})`);

  return lines.join("\n");
}
