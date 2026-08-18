import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// node:fs's own module namespace object has non-configurable properties
// (a real ESM/native-module constraint — vi.spyOn(fs, "existsSync") throws
// "Cannot redefine property"), so the "the other harness is never even
// read" assertions below instead mock node:fs at the module level, wrapping
// existsSync/readFileSync in vi.fn() while delegating to the real
// implementation for every other test in this file (mkdirSync, writeFileSync,
// etc. are untouched — real filesystem I/O against the hermetic temp `home`
// dir throughout, exactly as before).
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HARNESSES,
  SOURCE_SKILL_PATH,
  detect,
  harnessByName,
  parseArgs,
  resolveHome,
  runInit,
  runStatus,
  selectHarnesses,
  targetSkillPathFor,
} from "./agent-init.mjs";

const REAL_SKILL_CONTENT = readFileSync(SOURCE_SKILL_PATH, "utf8");

const claudeHarness = harnessByName("claude");
const codexHarness = harnessByName("codex");

// Every test operates against a real, freshly-created temporary directory
// standing in for HOME — never the operator's real ~/.claude/ or ~/.codex/.
// This is the hermetic counterpart to the live, real-machine verification
// run manually (see the story's make-tests-pass step). The Codex harness's
// own override, $CODEX_HOME, is saved/restored around every test so a
// stray leaked value can never leak into another test or, worse, resolve
// to this machine's real ~/.codex/.
describe("scripts/agent-init.mjs", () => {
  let home;
  let originalCodexHome;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "consus-agent-init-"));
    originalCodexHome = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    vi.restoreAllMocks();
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

  // The same four-state coverage, run once per harness definition so the
  // shared, parameterized detect/runInit/runStatus logic is exercised
  // identically for both Claude Code and Codex CLI — a single
  // implementation, not two diverging ones.
  for (const harness of HARNESSES) {
    describe(`harness: ${harness.name} (${harness.label})`, () => {
      describe(`npm run agent:init — state 1: no ${harness.label} base dir at all`, () => {
        it("reports clearly that no installation was detected and writes nothing", () => {
          const result = runInit(harness, home);
          expect(result.state).toBe("no-harness-dir");
          expect(result.wrote).toBe(false);
          expect(result.message).toMatch(/no .* installation detected/i);
          expect(result.message).toContain(harness.label);
        });

        it("does not create the base dir itself just to install into it", () => {
          runInit(harness, home);
          expect(existsSync(harness.dirFor(home))).toBe(false);
        });
      });

      describe(`npm run agent:init — state 2: base dir present, skill not yet installed`, () => {
        beforeEach(() => {
          mkdirSync(harness.dirFor(home), { recursive: true });
        });

        it("creates the skill file with content identical to the repo's own copy and reports 'installed'", () => {
          const result = runInit(harness, home);
          expect(result.state).toBe("not-installed");
          expect(result.wrote).toBe(true);
          expect(result.message).toMatch(/^installed/i);
          expect(readFileSync(targetSkillPathFor(harness, home), "utf8")).toBe(REAL_SKILL_CONTENT);
        });

        it("creates the skills/consus/ directory as needed", () => {
          runInit(harness, home);
          expect(existsSync(targetSkillPathFor(harness, home))).toBe(true);
        });
      });

      describe("npm run agent:init — state 3: installed and identical (idempotent no-op)", () => {
        beforeEach(() => {
          mkdirSync(harness.dirFor(home), { recursive: true });
          runInit(harness, home); // fresh install first
        });

        it("makes no write and reports 'already up to date' on a real byte-level comparison", () => {
          const beforeContent = readFileSync(targetSkillPathFor(harness, home), "utf8");
          const beforeMtime = statSync(targetSkillPathFor(harness, home)).mtimeMs;

          const result = runInit(harness, home);

          expect(result.state).toBe("current");
          expect(result.wrote).toBe(false);
          expect(result.message).toMatch(/already up to date/i);
          expect(readFileSync(targetSkillPathFor(harness, home), "utf8")).toBe(beforeContent);
          expect(statSync(targetSkillPathFor(harness, home)).mtimeMs).toBe(beforeMtime);
        });
      });

      describe("npm run agent:init — state 4: installed but stale (content differs)", () => {
        beforeEach(() => {
          mkdirSync(join(harness.dirFor(home), "skills", "consus"), { recursive: true });
          writeFileSync(targetSkillPathFor(harness, home), "a hand-edited, now-stale copy\n", "utf8");
        });

        it("overwrites the stale copy and reports 'updated (was stale)', distinct from 'installed' and 'already up to date'", () => {
          const result = runInit(harness, home);
          expect(result.state).toBe("stale");
          expect(result.wrote).toBe(true);
          expect(result.message).toMatch(/updated \(was stale\)/i);
          expect(result.message).not.toMatch(/already up to date/i);
          expect(readFileSync(targetSkillPathFor(harness, home), "utf8")).toBe(REAL_SKILL_CONTENT);
        });
      });

      describe("npm run agent:status — read-only across all four states", () => {
        it("reports 'no-harness-dir' without writing anything", () => {
          const result = runStatus(harness, home);
          expect(result.state).toBe("no-harness-dir");
          expect(result.wrote).toBe(false);
          expect(existsSync(harness.dirFor(home))).toBe(false);
        });

        it("reports 'not-installed' without creating the skill file", () => {
          mkdirSync(harness.dirFor(home), { recursive: true });
          const result = runStatus(harness, home);
          expect(result.state).toBe("not-installed");
          expect(existsSync(targetSkillPathFor(harness, home))).toBe(false);
        });

        it("reports 'current' and leaves the file's content/mtime untouched", () => {
          mkdirSync(harness.dirFor(home), { recursive: true });
          runInit(harness, home);
          const beforeContent = readFileSync(targetSkillPathFor(harness, home), "utf8");
          const beforeMtime = statSync(targetSkillPathFor(harness, home)).mtimeMs;

          const result = runStatus(harness, home);

          expect(result.state).toBe("current");
          expect(readFileSync(targetSkillPathFor(harness, home), "utf8")).toBe(beforeContent);
          expect(statSync(targetSkillPathFor(harness, home)).mtimeMs).toBe(beforeMtime);
        });

        it("reports 'stale' without fixing it — status never writes, even when init would", () => {
          mkdirSync(join(harness.dirFor(home), "skills", "consus"), { recursive: true });
          writeFileSync(targetSkillPathFor(harness, home), "a hand-edited, now-stale copy\n", "utf8");
          const beforeMtime = statSync(targetSkillPathFor(harness, home)).mtimeMs;

          const result = runStatus(harness, home);

          expect(result.state).toBe("stale");
          expect(readFileSync(targetSkillPathFor(harness, home), "utf8")).toBe(
            "a hand-edited, now-stale copy\n"
          );
          expect(statSync(targetSkillPathFor(harness, home)).mtimeMs).toBe(beforeMtime);
        });
      });

      describe("detect() — shared read-only detection", () => {
        it("never writes anything for any of the four states", () => {
          detect(harness, home);
          expect(existsSync(harness.dirFor(home))).toBe(false);

          mkdirSync(harness.dirFor(home), { recursive: true });
          detect(harness, home);
          expect(existsSync(targetSkillPathFor(harness, home))).toBe(false);
        });
      });
    });
  }

  describe("codex harness: $CODEX_HOME override", () => {
    it("uses $CODEX_HOME verbatim when set, instead of home + '/.codex'", () => {
      const codexHome = mkdtempSync(join(tmpdir(), "consus-agent-init-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      try {
        expect(codexHarness.dirFor(home)).toBe(codexHome);

        mkdirSync(codexHome, { recursive: true });
        const result = runInit(codexHarness, home);
        expect(result.state).toBe("not-installed");
        expect(result.harnessDir).toBe(codexHome);
        expect(readFileSync(join(codexHome, "skills", "consus", "SKILL.md"), "utf8")).toBe(
          REAL_SKILL_CONTENT
        );
        // Never touched home + "/.codex" — a distinct directory from the
        // real $CODEX_HOME override in this test.
        expect(existsSync(join(home, ".codex"))).toBe(false);
      } finally {
        rmSync(codexHome, { recursive: true, force: true });
      }
    });

    it("falls back to home + '/.codex' when $CODEX_HOME is unset", () => {
      delete process.env.CODEX_HOME;
      expect(codexHarness.dirFor(home)).toBe(join(home, ".codex"));
    });
  });

  describe("multiple harnesses run together report independent results", () => {
    it("Claude Code installed + Codex not detected in the same pass, neither affecting the other", () => {
      mkdirSync(claudeHarness.dirFor(home), { recursive: true });
      // Deliberately leave codexHarness.dirFor(home) absent.

      const results = HARNESSES.map((h) => runInit(h, home));
      const claudeResult = results.find((r) => r.harness === "claude");
      const codexResult = results.find((r) => r.harness === "codex");

      expect(claudeResult.state).toBe("not-installed");
      expect(claudeResult.wrote).toBe(true);
      expect(existsSync(targetSkillPathFor(claudeHarness, home))).toBe(true);

      expect(codexResult.state).toBe("no-harness-dir");
      expect(codexResult.wrote).toBe(false);
      expect(existsSync(codexHarness.dirFor(home))).toBe(false);
    });

    it("both harnesses installed independently get their own byte-level comparison, not a shared/coupled state", () => {
      mkdirSync(claudeHarness.dirFor(home), { recursive: true });
      mkdirSync(codexHarness.dirFor(home), { recursive: true });

      for (const h of HARNESSES) runInit(h, home);

      // Now hand-edit only the Codex copy stale and re-run both.
      writeFileSync(targetSkillPathFor(codexHarness, home), "stale codex copy\n", "utf8");

      const claudeResult = runInit(claudeHarness, home);
      const codexResult = runInit(codexHarness, home);

      expect(claudeResult.state).toBe("current");
      expect(claudeResult.wrote).toBe(false);
      expect(codexResult.state).toBe("stale");
      expect(codexResult.wrote).toBe(true);
      expect(readFileSync(targetSkillPathFor(codexHarness, home), "utf8")).toBe(REAL_SKILL_CONTENT);
    });
  });

  describe("selectHarnesses() / harnessByName() / parseArgs() — --harness narrowing", () => {
    it("selectHarnesses(null) returns every configured harness (today's default, now widened)", () => {
      expect(selectHarnesses(null)).toBe(HARNESSES);
    });

    it("selectHarnesses('codex') narrows to just the Codex harness", () => {
      expect(selectHarnesses("codex")).toEqual([codexHarness]);
    });

    it("selectHarnesses('claude') narrows to just the Claude Code harness", () => {
      expect(selectHarnesses("claude")).toEqual([claudeHarness]);
    });

    it("harnessByName() throws on an unknown harness name rather than silently ignoring it", () => {
      expect(() => harnessByName("bogus")).toThrow(/unknown harness/i);
    });

    it("parseArgs() reads the mode positional and --harness flag (space-separated and --harness=value forms)", () => {
      expect(parseArgs(["node", "agent-init.mjs", "init"])).toEqual({
        mode: "init",
        harnessFilter: null,
      });
      expect(parseArgs(["node", "agent-init.mjs", "status"])).toEqual({
        mode: "status",
        harnessFilter: null,
      });
      expect(parseArgs(["node", "agent-init.mjs", "init", "--harness", "codex"])).toEqual({
        mode: "init",
        harnessFilter: "codex",
      });
      expect(parseArgs(["node", "agent-init.mjs", "status", "--harness=claude"])).toEqual({
        mode: "status",
        harnessFilter: "claude",
      });
    });

    it("--harness codex genuinely never even checks/reads the Claude Code harness — not just skips writing it", () => {
      // Pre-create a real, "not-installed" Claude Code dir. If the Claude
      // harness were even detected (existsSync/readFileSync called against
      // its paths), that would be observable here — this test asserts it
      // is not.
      mkdirSync(claudeHarness.dirFor(home), { recursive: true });
      mkdirSync(codexHarness.dirFor(home), { recursive: true });

      existsSync.mockClear();
      readFileSync.mockClear();

      const harnesses = selectHarnesses("codex");
      for (const h of harnesses) runInit(h, home);

      const claudeDir = claudeHarness.dirFor(home);
      const claudeTargetPath = targetSkillPathFor(claudeHarness, home);

      for (const call of existsSync.mock.calls) {
        expect(String(call[0])).not.toContain(claudeDir);
      }
      for (const call of readFileSync.mock.calls) {
        expect(String(call[0])).not.toBe(claudeTargetPath);
      }

      // And the Claude Code skill file was genuinely never created either
      // (a install would have written it, proving it wasn't even reached).
      expect(existsSync(claudeTargetPath)).toBe(false);
      // Codex, meanwhile, really was installed.
      expect(existsSync(targetSkillPathFor(codexHarness, home))).toBe(true);
    });

    it("--harness claude genuinely never even checks/reads the Codex harness — not just skips writing it", () => {
      mkdirSync(claudeHarness.dirFor(home), { recursive: true });
      mkdirSync(codexHarness.dirFor(home), { recursive: true });

      existsSync.mockClear();
      readFileSync.mockClear();

      const harnesses = selectHarnesses("claude");
      for (const h of harnesses) runInit(h, home);

      const codexDir = codexHarness.dirFor(home);
      const codexTargetPath = targetSkillPathFor(codexHarness, home);

      for (const call of existsSync.mock.calls) {
        expect(String(call[0])).not.toContain(codexDir);
      }
      for (const call of readFileSync.mock.calls) {
        expect(String(call[0])).not.toBe(codexTargetPath);
      }

      expect(existsSync(codexTargetPath)).toBe(false);
      expect(existsSync(targetSkillPathFor(claudeHarness, home))).toBe(true);
    });
  });
});
