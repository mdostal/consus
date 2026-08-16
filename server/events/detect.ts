import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { queryDocIndex, readDocContent, type DocIndexRow } from "../adapters/doc-scanner/index.js";
import { readGitDoc } from "../adapters/gitdocs/index.js";
import { parseDecisionPayload, serializeDecisionPayload, type DecisionPayload } from "../decision-contract/parser.js";
import { classifyItem } from "../decision-contract/classifier.js";
import { computeLineDiff } from "./diff.js";
import { createEvent } from "./store.js";

/**
 * p14-2: event-detection, run once per project immediately after that
 * project's scanRepo call (server/routes/projects.ts's ingest route and its
 * new scan-all loop). See docs/design-discussion.md sections 1 and 3, and
 * this story's yaml for the exact algorithm this ports.
 */

export interface DetectEventsInput {
  project: string;
  repoName: string;
  repoPath: string;
  /**
   * `file_path -> content_hash` snapshot of this repo's doc_index rows,
   * read by the caller *before* calling scanRepo (the "prior hash before
   * the upsert runs" the doc_changed pass needs). detectEvents itself only
   * ever reads doc_index *after* scanRepo has run (via queryDocIndex), so
   * this snapshot is the only way it can know what changed — scanRepo
   * itself is never modified to emit change notifications (see the story's
   * design_decisions).
   */
  previousHashes: Map<string, string>;
}

const FENCED_DECISION_REQUEST_BLOCK = /```decision-request\s*\n([\s\S]*?)\n```/;
const SURROUNDING_CONTENT_THRESHOLD = 4000;
const NO_PRIOR_CONTENT_NOTE = "no prior content on record for comparison — showing current content";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Server-side port of web/src/features/docs/sections.ts's splitIntoSections
 * — see that file's docstring for the naive-regex-split caveat this
 * inherits. Duplicated rather than imported for the same reason
 * computeLineDiff is duplicated in diff.ts: no shared package boundary
 * between web/ and server/ in this repo.
 */
function splitIntoSections(content: string): string[] {
  const parts = content.split(/(?=^#{1,3} )/m).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [content];
}

/** Picks the first section containing `needle` as a substring, falling back
 *  to the first section when `needle` is null/empty or nothing matches. */
function pickSection(sections: string[], needle: string | null): string {
  if (needle) {
    const found = sections.find((section) => section.includes(needle));
    if (found) return found;
  }
  return sections[0];
}

function surroundingContent(content: string, needle: string | null): string {
  if (content.length < SURROUNDING_CONTENT_THRESHOLD) {
    return content;
  }
  return pickSection(splitIntoSections(content), needle);
}

function epicPhaseLine(epic: string | null, phase: string | null): string | null {
  if (epic === null && phase === null) {
    return null;
  }
  const value = epic === null ? `phase: ${phase}` : `epic: ${epic}, phase: ${phase}`;
  return `epic/phase (if under .pHive/epics/**): ${value}`;
}

function projectAreaSection(project: string, repoName: string, filePath: string, epic: string | null, phase: string | null): string {
  const lines = [`project: ${project}  repo: ${repoName}  path: ${filePath}`];
  const epicPhase = epicPhaseLine(epic, phase);
  if (epicPhase) lines.push(epicPhase);
  return lines.join("\n");
}

interface ComposeDocChangedInput {
  kind: "doc_changed";
  project: string;
  repoName: string;
  filePath: string;
  epic: string | null;
  phase: string | null;
  diff: string;
  usedFallback: boolean;
  content: string;
}

interface ComposeDecisionNeededInput {
  kind: "decision_needed";
  project: string;
  repoName: string;
  filePath: string;
  epic: string | null;
  phase: string | null;
  content: string;
  payload: DecisionPayload;
}

type ComposePromptInput = ComposeDocChangedInput | ComposeDecisionNeededInput;

/** Builds the composed_prompt stored once, at detection time, on the event
 *  row — never recomputed by a later read. See the story's section 4
 *  template. */
export function composePrompt(input: ComposePromptInput): string {
  const header = `# Event: ${input.kind} in ${input.project} — ${input.repoName}/${input.filePath}`;
  const projectArea = projectAreaSection(input.project, input.repoName, input.filePath, input.epic, input.phase);

  let whatChanged: string;
  let matchNeedle: string | null;

  if (input.kind === "doc_changed") {
    const note = input.usedFallback ? NO_PRIOR_CONTENT_NOTE : "content_hash changed since last scan";
    whatChanged = `${input.diff}\n\n${note}`;
    const changedLines = input.diff
      .split("\n")
      .filter((line) => line.startsWith("+ ") || line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter((line) => line.length > 0);
    matchNeedle = changedLines.find((line) => input.content.includes(line)) ?? null;
  } else {
    const fenced = FENCED_DECISION_REQUEST_BLOCK.exec(input.content);
    const block = fenced ? fenced[0] : input.content;
    const optionsText = input.payload.options
      .map((option) => `${option.id}: ${option.title} (${option.tradeoffs})`)
      .join("\n");
    whatChanged = [
      block,
      "",
      `title: ${input.payload.title}`,
      `context: ${input.payload.context}`,
      `options:\n${optionsText}`,
      `recommended: ${input.payload.recommended}`,
      "unresolved decision-request block, no decided_at",
    ].join("\n");
    matchNeedle = fenced ? fenced[0] : null;
  }

  const surrounding = surroundingContent(input.content, matchNeedle);

  return [
    header,
    "",
    "## Project / area",
    projectArea,
    "",
    "## What changed",
    whatChanged,
    "",
    "## Surrounding doc content",
    surrounding,
  ].join("\n");
}

function detectDocChangedForRow(
  db: Database.Database,
  { project, repoName, repoPath }: { project: string; repoName: string; repoPath: string },
  row: DocIndexRow,
  previousHash: string | null,
): boolean {
  const { content } = readDocContent(repoPath, row.file_path);

  let diff: string;
  let usedFallback: boolean;

  if (previousHash === null) {
    // Brand-new file: the full content presented as an addition, no
    // special-casing beyond passing "" as the original.
    diff = computeLineDiff("", content);
    usedFallback = false;
  } else {
    let headContent: string | null = null;
    try {
      headContent = readGitDoc(repoPath, row.file_path, "HEAD").content;
    } catch {
      // Untracked file, no git repo, bad ref — fall through to the
      // no-prior-content fallback rather than aborting this doc's
      // detection or the whole project's scan.
      headContent = null;
    }

    if (headContent !== null && sha256(headContent) !== row.content_hash) {
      diff = computeLineDiff(headContent, content);
      usedFallback = false;
    } else {
      // Either readGitDoc threw, or HEAD's content already matches the new
      // content (the change predates HEAD — diffing against it would show
      // nothing).
      diff = computeLineDiff("", content);
      usedFallback = true;
    }
  }

  const composedPrompt = composePrompt({
    kind: "doc_changed",
    project,
    repoName,
    filePath: row.file_path,
    epic: row.epic,
    phase: row.phase,
    diff,
    usedFallback,
    content,
  });

  createEvent(db, {
    project,
    triggerKind: "doc_changed",
    sourceRepo: repoName,
    sourcePath: row.file_path,
    contentHash: row.content_hash,
    previousHash,
    diff,
    composedPrompt,
  });

  return true;
}

/** decisionItemId's namespace ('decision:repo:path') is deliberately
 *  distinct from server/routes/docs.ts's docItemIdFor ('doc:repo:path') —
 *  see the story's design_decisions for why reusing docItemIdFor's id would
 *  risk a doc-typed item silently never being upgraded to carry decision
 *  fields (or vice versa). The 'decision:' / 'doc:' prefixes can never
 *  collide. */
function decisionItemIdFor(repoName: string, filePath: string): string {
  return `decision:${repoName}:${filePath}`;
}

function detectDecisionNeededForRow(
  db: Database.Database,
  { project, repoName, repoPath }: { project: string; repoName: string; repoPath: string },
  row: DocIndexRow,
): boolean {
  const { content } = readDocContent(repoPath, row.file_path);
  const payload = parseDecisionPayload(content);
  if (!payload) return false;

  const decisionItemId = decisionItemIdFor(repoName, row.file_path);

  // "No existing open tracking item" is resolved as a content-hash-scoped
  // drift check against open events, not a bare existence check against
  // items — an existing (possibly already-tracked-and-undecided) items row
  // at decisionItemId does not, by itself, disqualify a new event; only an
  // open event already covering this exact content_hash does. This is what
  // makes "content drifted further, even though the old event is still
  // open" produce a new event rather than silent staleness.
  const driftMatch = db
    .prepare(
      `SELECT id FROM events WHERE source_repo = ? AND source_path = ? AND trigger_kind = 'decision_needed' AND content_hash = ? AND status IN ('new','in_progress')`,
    )
    .get(repoName, row.file_path, row.content_hash);
  if (driftMatch) return false;

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source_repo, source_ref, decision_payload, created_at, updated_at)
     VALUES (@id, 'decision', @title, 'active', @repo, @path, @decision_payload, @now, @now)
     ON CONFLICT(id) DO UPDATE SET decision_payload = excluded.decision_payload, updated_at = excluded.updated_at`,
  ).run({
    id: decisionItemId,
    title: payload.title,
    repo: repoName,
    path: row.file_path,
    decision_payload: serializeDecisionPayload(payload),
    now,
  });

  classifyItem(db, decisionItemId);

  const composedPrompt = composePrompt({
    kind: "decision_needed",
    project,
    repoName,
    filePath: row.file_path,
    epic: row.epic,
    phase: row.phase,
    content,
    payload,
  });

  createEvent(db, {
    project,
    triggerKind: "decision_needed",
    sourceRepo: repoName,
    sourcePath: row.file_path,
    contentHash: row.content_hash,
    previousHash: null,
    diff: null,
    itemId: decisionItemId,
    composedPrompt,
  });

  return true;
}

/**
 * Runs both detection passes (doc_changed, decision_needed) for one
 * project's repo, immediately after that project's scanRepo call, and
 * creates an events row (via p14-1's createEvent) for each detected
 * change. Returns the number of events created.
 */
export function detectEvents(db: Database.Database, input: DetectEventsInput): number {
  const { project, repoName, repoPath, previousHashes } = input;
  const ctx = { project, repoName, repoPath };
  let count = 0;

  const currentRows = queryDocIndex(db, repoName);

  // Pass A — doc_changed. Mirrors scanRepo's own no-op-on-unchanged-hash
  // behavior: a row whose hash is identical to its pre-scan value produces
  // no event at all.
  for (const row of currentRows) {
    const priorHash = previousHashes.get(row.file_path);
    if (priorHash === row.content_hash) continue;
    const previousHash = priorHash === undefined ? null : priorHash;
    if (detectDocChangedForRow(db, ctx, row, previousHash)) count++;
  }

  // Pass B — decision_needed. Runs over every current doc, changed or not —
  // a decision-request block can exist in an unchanged, still-open file.
  for (const row of currentRows) {
    if (detectDecisionNeededForRow(db, ctx, row)) count++;
  }

  return count;
}
