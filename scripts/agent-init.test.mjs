import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SOURCE_SKILL_PATH,
  claudeDirFor,
  detect,
  resolveHome,
  runInit,
  runStatus,
  targetSkillPathFor,
} from "./agent-init.mjs";

const REAL_SKILL_CONTENT = readFileSync(SOURCE_SKILL_PATH, "utf8");

// Every test operates against a real, freshly-created temporary directory
// standing in for HOME — never the operator's real ~/.claude/. This is the
// hermetic counterpart to the live, real-machine verification run manually
// (see the story's make-tests-pass step).
describe("scripts/agent-init.mjs", () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "consus-agent-init-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  describe("resolveHome()", () => {
    it("honors CONSUS_AGENT_INIT_HOME when set", () => {
      const original = process.env.CONSUS_AGENT_INIT_HOME;
      process.env.CONSUS_AGENT_INIT_HOME = home;
      try {
        expect(resolveHome()).toBe(home);
      } finally {
        if (original === undefined) delete process.env.CONSUS_AGENT_INIT_HOME;
        else process.env.CONSUS_AGENT_INIT_HOME = original;
      }
    });

    it("falls back to a real os.homedir() when the override is unset", () => {
      const original = process.env.CONSUS_AGENT_INIT_HOME;
      delete process.env.CONSUS_AGENT_INIT_HOME;
      try {
        expect(resolveHome()).not.toBe("");
        expect(typeof resolveHome()).toBe("string");
      } finally {
        if (original !== undefined) process.env.CONSUS_AGENT_INIT_HOME = original;
      }
    });
  });

  describe("npm run agent:init — state 1: no ~/.claude/ at all", () => {
    it("reports clearly that no Claude Code installation was detected and writes nothing", () => {
      const result = runInit(home);
      expect(result.state).toBe("no-claude-dir");
      expect(result.wrote).toBe(false);
      expect(result.message).toMatch(/no claude code installation detected/i);
    });

    it("does not create ~/.claude/ itself just to install into it", () => {
      runInit(home);
      expect(existsSync(claudeDirFor(home))).toBe(false);
    });
  });

  describe("npm run agent:init — state 2: ~/.claude/ present, skill not yet installed", () => {
    beforeEach(() => {
      mkdirSync(claudeDirFor(home), { recursive: true });
    });

    it("creates the skill file with content identical to the repo's own copy and reports 'installed'", () => {
      const result = runInit(home);
      expect(result.state).toBe("not-installed");
      expect(result.wrote).toBe(true);
      expect(result.message).toMatch(/^installed/i);
      expect(readFileSync(targetSkillPathFor(home), "utf8")).toBe(REAL_SKILL_CONTENT);
    });

    it("creates the ~/.claude/skills/consus/ directory as needed", () => {
      runInit(home);
      expect(existsSync(targetSkillPathFor(home))).toBe(true);
    });
  });

  describe("npm run agent:init — state 3: installed and identical (idempotent no-op)", () => {
    beforeEach(() => {
      mkdirSync(claudeDirFor(home), { recursive: true });
      runInit(home); // fresh install first
    });

    it("makes no write and reports 'already up to date' on a real byte-level comparison", () => {
      const beforeContent = readFileSync(targetSkillPathFor(home), "utf8");
      const beforeMtime = statSync(targetSkillPathFor(home)).mtimeMs;

      const result = runInit(home);

      expect(result.state).toBe("current");
      expect(result.wrote).toBe(false);
      expect(result.message).toMatch(/already up to date/i);
      expect(readFileSync(targetSkillPathFor(home), "utf8")).toBe(beforeContent);
      expect(statSync(targetSkillPathFor(home)).mtimeMs).toBe(beforeMtime);
    });
  });

  describe("npm run agent:init — state 4: installed but stale (content differs)", () => {
    beforeEach(() => {
      mkdirSync(join(claudeDirFor(home), "skills", "consus"), { recursive: true });
      writeFileSync(targetSkillPathFor(home), "a hand-edited, now-stale copy\n", "utf8");
    });

    it("overwrites the stale copy and reports 'updated (was stale)', distinct from 'installed' and 'already up to date'", () => {
      const result = runInit(home);
      expect(result.state).toBe("stale");
      expect(result.wrote).toBe(true);
      expect(result.message).toMatch(/updated \(was stale\)/i);
      expect(result.message).not.toMatch(/already up to date/i);
      expect(readFileSync(targetSkillPathFor(home), "utf8")).toBe(REAL_SKILL_CONTENT);
    });
  });

  describe("npm run agent:status — read-only across all four states", () => {
    it("reports 'no-claude-dir' without writing anything", () => {
      const result = runStatus(home);
      expect(result.state).toBe("no-claude-dir");
      expect(result.wrote).toBe(false);
      expect(existsSync(claudeDirFor(home))).toBe(false);
    });

    it("reports 'not-installed' without creating the skill file", () => {
      mkdirSync(claudeDirFor(home), { recursive: true });
      const result = runStatus(home);
      expect(result.state).toBe("not-installed");
      expect(existsSync(targetSkillPathFor(home))).toBe(false);
    });

    it("reports 'current' and leaves the file's content/mtime untouched", () => {
      mkdirSync(claudeDirFor(home), { recursive: true });
      runInit(home);
      const beforeContent = readFileSync(targetSkillPathFor(home), "utf8");
      const beforeMtime = statSync(targetSkillPathFor(home)).mtimeMs;

      const result = runStatus(home);

      expect(result.state).toBe("current");
      expect(readFileSync(targetSkillPathFor(home), "utf8")).toBe(beforeContent);
      expect(statSync(targetSkillPathFor(home)).mtimeMs).toBe(beforeMtime);
    });

    it("reports 'stale' without fixing it — status never writes, even when init would", () => {
      mkdirSync(join(claudeDirFor(home), "skills", "consus"), { recursive: true });
      writeFileSync(targetSkillPathFor(home), "a hand-edited, now-stale copy\n", "utf8");
      const beforeMtime = statSync(targetSkillPathFor(home)).mtimeMs;

      const result = runStatus(home);

      expect(result.state).toBe("stale");
      expect(readFileSync(targetSkillPathFor(home), "utf8")).toBe("a hand-edited, now-stale copy\n");
      expect(statSync(targetSkillPathFor(home)).mtimeMs).toBe(beforeMtime);
    });
  });

  describe("detect() — shared read-only detection", () => {
    it("never writes anything for any of the four states", () => {
      detect(home);
      expect(existsSync(claudeDirFor(home))).toBe(false);

      mkdirSync(claudeDirFor(home), { recursive: true });
      detect(home);
      expect(existsSync(targetSkillPathFor(home))).toBe(false);
    });
  });
});
