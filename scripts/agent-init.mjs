#!/usr/bin/env node
// scripts/agent-init.mjs
//
// A small, dependency-free Node script (matches this repo's existing
// scripts/start.sh convention of plain scripts over a build step) backing
// two package.json scripts:
//
//   npm run agent:init    — installs/updates skills/consus/SKILL.md into
//                           ~/.claude/skills/consus/SKILL.md so any Claude
//                           Code session on this machine can read it,
//                           regardless of cwd/repo.
//   npm run agent:status  — the same detection, read-only, never writes.
//
// v1 targets Claude Code only (see
// .pHive/epics/consus-phase19-agent-harness-onboarding/docs/design-discussion.md,
// "Scope decision: Claude Code only for v1") — no Codex CLI or other harness
// detection here.
//
// Detection is a plain filesystem check for ~/.claude/ existing, never a
// shell-out to the `claude` binary itself — the design discussion's cited
// precedent found that a naive `claude mcp list`-style call health-checks
// every registered MCP server (30+ seconds on a machine with many
// configured); a filesystem check answers the same underlying question
// ("has Claude Code been used on this machine?") without that cost.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

/** This repo's own copy of the skill file — read-only source, never
 *  modified by this script. */
export const SOURCE_SKILL_PATH = join(REPO_ROOT, "skills", "consus", "SKILL.md");

/**
 * Resolves the HOME directory to operate against. Honors
 * CONSUS_AGENT_INIT_HOME when set (so automated tests can exercise every
 * real state against a real temporary directory without ever touching the
 * operator's actual ~/.claude/); falls back to the real os.homedir() with
 * zero extra flags/env vars needed for a real operator running
 * `npm run agent:init`.
 */
export function resolveHome() {
  const override = process.env.CONSUS_AGENT_INIT_HOME;
  return override && override.trim() !== "" ? override : homedir();
}

export function claudeDirFor(home) {
  return join(home, ".claude");
}

export function targetSkillDirFor(home) {
  return join(claudeDirFor(home), "skills", "consus");
}

export function targetSkillPathFor(home) {
  return join(targetSkillDirFor(home), "SKILL.md");
}

/**
 * Read-only detection shared by both agent:init and agent:status. Never
 * writes anything, under any circumstance. Resolves to one of four states:
 *
 *  - "no-claude-dir": ~/.claude/ doesn't exist at all — no Claude Code
 *    installation detected on this machine.
 *  - "not-installed": ~/.claude/ exists, but the consus skill file doesn't.
 *  - "current": installed and byte-identical to this repo's own copy.
 *  - "stale": installed but its content differs from this repo's own copy
 *    (a real content comparison — not an existence/mtime check).
 */
export function detect(home) {
  const claudeDir = claudeDirFor(home);
  const targetPath = targetSkillPathFor(home);

  if (!existsSync(claudeDir)) {
    return { state: "no-claude-dir", claudeDir, targetPath };
  }

  if (!existsSync(targetPath)) {
    return { state: "not-installed", claudeDir, targetPath };
  }

  const sourceContent = readFileSync(SOURCE_SKILL_PATH, "utf8");
  const targetContent = readFileSync(targetPath, "utf8");
  return { state: sourceContent === targetContent ? "current" : "stale", claudeDir, targetPath };
}

/**
 * The real install/update action. Never creates ~/.claude/ itself — if
 * it's absent, this is a pure no-op report (per acceptance criteria: must
 * not create ~/.claude/ itself just to install into it). Otherwise
 * compares real byte content before deciding install / no-op / update, and
 * always reports which of the three distinctly.
 */
export function runInit(home) {
  const detection = detect(home);

  if (detection.state === "no-claude-dir") {
    return {
      ...detection,
      wrote: false,
      message: `No Claude Code installation detected (${detection.claudeDir} not found) — nothing to install. No files were changed.`,
    };
  }

  if (detection.state === "current") {
    return {
      ...detection,
      wrote: false,
      message: `Already up to date: ${detection.targetPath} matches this repo's skills/consus/SKILL.md. No changes made.`,
    };
  }

  const sourceContent = readFileSync(SOURCE_SKILL_PATH, "utf8");
  mkdirSync(targetSkillDirFor(home), { recursive: true });
  writeFileSync(detection.targetPath, sourceContent, "utf8");

  if (detection.state === "not-installed") {
    return {
      ...detection,
      wrote: true,
      message: `Installed: created ${detection.targetPath}.`,
    };
  }

  // detection.state === "stale"
  return {
    ...detection,
    wrote: true,
    message: `Updated (was stale): ${detection.targetPath} differed from this repo's skills/consus/SKILL.md and has been overwritten.`,
  };
}

/**
 * The read-only status check. Literally never writes — including on the
 * "stale" path, where agent:init would overwrite but agent:status only
 * reports it.
 */
export function runStatus(home) {
  const detection = detect(home);
  const messages = {
    "no-claude-dir": `No Claude Code installation detected (${detection.claudeDir} not found).`,
    "not-installed": `${detection.claudeDir} exists, but the consus skill is not installed (${detection.targetPath} not found). Run "npm run agent:init" to install it.`,
    current: `Installed and up to date: ${detection.targetPath} matches this repo's skills/consus/SKILL.md.`,
    stale: `Installed but stale: ${detection.targetPath} differs from this repo's skills/consus/SKILL.md. Run "npm run agent:init" to update.`,
  };
  return { ...detection, wrote: false, message: messages[detection.state] };
}

function main() {
  const mode = process.argv[2] === "status" ? "status" : "init";
  const home = resolveHome();
  const result = mode === "status" ? runStatus(home) : runInit(home);
  console.log(result.message);
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
