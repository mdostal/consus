import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendDecisionLog, readDecisionLog, composeIterateComment } from "./decision-log.js";

describe("composeIterateComment", () => {
  it("omits the mention line entirely when no agent is given", () => {
    const body = composeIterateComment({
      title: "Ship v1?",
      issueIdentifier: "DOS-1",
      issueId: "i-1",
      prompt: "please redo the diagram",
      scope: null,
      agent: null,
      actor: "mathew",
      logId: "log-1",
    });

    expect(body).not.toContain("mention://agent/");
  });

  it("includes the exact mention://agent/<id> line when an agent is given", () => {
    const body = composeIterateComment({
      title: "Ship v1?",
      issueIdentifier: "DOS-1",
      issueId: "i-1",
      prompt: "please redo the diagram",
      scope: null,
      agent: { id: "agent-123", name: "researcher" },
      actor: "mathew",
      logId: "log-1",
    });

    expect(body).toContain("[@researcher](mention://agent/agent-123)");
  });

  it("includes the prompt verbatim", () => {
    const body = composeIterateComment({
      title: "t",
      issueIdentifier: null,
      issueId: "i-1",
      prompt: "redo this exactly as written, keep the tone",
      scope: null,
      agent: null,
      actor: "mathew",
      logId: "log-1",
    });

    expect(body).toContain("redo this exactly as written, keep the tone");
  });

  it("includes scope.section and scope.diagram context lines only when provided", () => {
    const withScope = composeIterateComment({
      title: "t",
      issueIdentifier: null,
      issueId: "i-1",
      prompt: "p",
      scope: { section: "risks", diagram: "cascade" },
      agent: null,
      actor: "mathew",
      logId: "log-1",
    });
    expect(withScope).toContain("section: risks");
    expect(withScope).toContain("diagram: cascade");

    const withoutScope = composeIterateComment({
      title: "t",
      issueIdentifier: null,
      issueId: "i-1",
      prompt: "p",
      scope: null,
      agent: null,
      actor: "mathew",
      logId: "log-1",
    });
    expect(withoutScope).not.toContain("Scope —");
  });

  it("includes the explicit new-version instruction", () => {
    const body = composeIterateComment({
      title: "t",
      issueIdentifier: null,
      issueId: "i-1",
      prompt: "p",
      scope: null,
      agent: null,
      actor: "mathew",
      logId: "log-1",
    });

    expect(body).toContain("Deliver as a NEW version");
    expect(body).toContain("do not overwrite the original");
  });
});

describe("appendDecisionLog / readDecisionLog", () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "consus-decision-log-"));
    logPath = join(dir, "decision-log.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list (not an error) when the log file doesn't exist yet", async () => {
    const entries = await readDecisionLog(logPath);
    expect(entries).toEqual([]);
  });

  it("appends an entry and reads it back", async () => {
    await appendDecisionLog(logPath, {
      actor: "mathew",
      issue: { id: "i-1", identifier: "DOS-1", title: "Ship v1?" },
      prompt: "redo it",
      scope: null,
      agent: null,
      commentId: "c-1",
      statusSet: null,
      previousStatus: null,
    });

    const entries = await readDecisionLog(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].prompt).toBe("redo it");
    expect(entries[0].comment_id).toBe("c-1");
  });

  it("returns entries most-recent-first", async () => {
    await appendDecisionLog(logPath, {
      actor: "mathew",
      issue: { id: "i-1", identifier: null, title: "first" },
      prompt: "p1",
      scope: null,
      agent: null,
      commentId: "c-1",
      statusSet: null,
      previousStatus: null,
    });
    await appendDecisionLog(logPath, {
      actor: "mathew",
      issue: { id: "i-2", identifier: null, title: "second" },
      prompt: "p2",
      scope: null,
      agent: null,
      commentId: "c-2",
      statusSet: null,
      previousStatus: null,
    });

    const entries = await readDecisionLog(logPath);
    expect(entries.map((e) => e.issue.title)).toEqual(["second", "first"]);
  });

  it("caps results at the given limit, and clamps to max 1000", async () => {
    for (let i = 0; i < 5; i++) {
      await appendDecisionLog(logPath, {
        actor: "mathew",
        issue: { id: `i-${i}`, identifier: null, title: `t${i}` },
        prompt: "p",
        scope: null,
        agent: null,
        commentId: `c-${i}`,
        statusSet: null,
        previousStatus: null,
      });
    }

    const capped = await readDecisionLog(logPath, 2);
    expect(capped).toHaveLength(2);

    const overCapped = await readDecisionLog(logPath, 5000);
    expect(overCapped).toHaveLength(5); // only 5 entries exist; clamp just bounds the cap, not a floor
  });
});
