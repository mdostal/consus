#!/usr/bin/env node
// scripts/agent-init.mjs
//
// A small, dependency-free Node script (matches this repo's existing
// scripts/start.sh convention of plain scripts over a build step) backing
// two package.json scripts:
//
//   npm run agent:init    — installs/updates skills/consus/SKILL.md into
//                           every configured agent harness's own skills
//                           directory (~/.claude/skills/consus/SKILL.md,
//                           $CODEX_HOME/skills/consus/SKILL.md) so any
//                           supported harness session on this machine can
//                           read it, regardless of cwd/repo.
//   npm run agent:status  — the same detection, read-only, never writes.
//
// v1 (consus-phase19) targeted Claude Code only. This story
// (consus-phase21-codex-cli-support) generalizes the Claude-Code-only logic
// below into a small per-harness table and adds Codex CLI as a second real
// target — see
// .pHive/epics/consus-phase21-codex-cli-support/docs/design-discussion.md
// for the full verification trail behind Codex's install convention
// (confirmed directly against a real, installed Codex CLI on this machine:
// its own `skill-installer` system skill documents "Installs into
// $CODEX_HOME/skills/<skill-name> (defaults to ~/.codex/skills)").
//
// Detection is a plain filesystem check for each harness's own base
// directory existing, never a shell-out to a harness binary itself — the
// consus-phase19 design discussion's cited precedent found that a naive
// `claude mcp list`-style call health-checks every registered MCP server
// (30+ seconds on a machine with many configured); a filesystem check
// answers the same underlying question ("has this harness been used on
// this machine?") without that cost.
//
// A --harness claude / --harness codex CLI flag (mirroring Portunus's own
// --harness flag) narrows a single run to just one harness — when passed,
// the other harness is not even detected/read, not just skipped for
// writing. Omitting the flag runs against every harness in HARNESSES,
// which is today's (Claude-Code-only) default behavior for anyone who
// never passes it, now widened to include Codex CLI too.

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
 * operator's actual ~/.claude/ or ~/.codex/); falls back to the real
 * os.homedir() with zero extra flags/env vars needed for a real operator
 * running `npm run agent:init`.
 */
export function resolveHome() {
  const override = process.env.CONSUS_AGENT_INIT_HOME;
  return override && override.trim() !== "" ? override : homedir();
}

/**
 * The per-harness table this story introduces. Each entry provides:
 *   - name: the stable identifier used by --harness and in result objects.
 *   - label: a human-readable name for status/init output.
 *   - dirFor(home): resolves this harness's own base directory.
 *
 * Both harnesses share an identical skill target subpath under their own
 * base directory ("skills/consus/SKILL.md") — see targetSkillPathFor().
 */
export const HARNESSES = [
  {
    name: "claude",
    label: "Claude Code",
    dirFor(home) {
      return join(home, ".claude");
    },
  },
  {
    name: "codex",
    label: "Codex CLI",
    // Honors the real $CODEX_HOME env var Codex itself reads (confirmed
    // via Codex's own bundled skill-installer doc — see this epic's
    // design-discussion.md), falling back to ~/.codex when unset. This is
    // also how tests keep the Codex path hermetic: pointing CODEX_HOME at
    // a real temp directory exercises the exact same code path a real
    // operator's own override would, never the operator's real ~/.codex/.
    dirFor(home) {
      const override = process.env.CODEX_HOME;
      return override && override.trim() !== "" ? override : join(home, ".codex");
    },
  },
];

/** Looks up a harness definition by name, throwing on an unknown --harness
 *  value rather than silently ignoring it. */
export function harnessByName(name) {
  const harness = HARNESSES.find((h) => h.name === name);
  if (!harness) {
    throw new Error(
      `Unknown harness "${name}" — expected one of: ${HARNESSES.map((h) => h.name).join(", ")}.`
    );
  }
  return harness;
}

/**
 * Narrows HARNESSES to a single entry when filterName is truthy (the
 * --harness flag's effect); returns every configured harness unchanged
 * otherwise. Callers must iterate only the harnesses this returns — the
 * whole point of --harness is that the other harness is never even
 * detected/read, not just skipped for writing.
 */
export function selectHarnesses(filterName) {
  if (!filterName) return HARNESSES;
  return [harnessByName(filterName)];
}

export function targetSkillDirFor(harness, home) {
  return join(harness.dirFor(home), "skills", "consus");
}

export function targetSkillPathFor(harness, home) {
  return join(targetSkillDirFor(harness, home), "SKILL.md");
}

/**
 * Read-only detection shared by both agent:init and agent:status, now
 * parameterized per harness instead of hardcoded to Claude Code. Never
 * writes anything, under any circumstance. Resolves to one of four states:
 *
 *  - "no-harness-dir": this harness's base directory doesn't exist at all
 *    — no installation of it detected on this machine.
 *  - "not-installed": the base directory exists, but the consus skill file
 *    doesn't.
 *  - "current": installed and byte-identical to this repo's own copy.
 *  - "stale": installed but its content differs from this repo's own copy
 *    (a real content comparison — not an existence/mtime check).
 */
export function detect(harness, home) {
  const harnessDir = harness.dirFor(home);
  const targetPath = targetSkillPathFor(harness, home);

  if (!existsSync(harnessDir)) {
    return { harness: harness.name, state: "no-harness-dir", harnessDir, targetPath };
  }

  if (!existsSync(targetPath)) {
    return { harness: harness.name, state: "not-installed", harnessDir, targetPath };
  }

  const sourceContent = readFileSync(SOURCE_SKILL_PATH, "utf8");
  const targetContent = readFileSync(targetPath, "utf8");
  return {
    harness: harness.name,
    state: sourceContent === targetContent ? "current" : "stale",
    harnessDir,
    targetPath,
  };
}

/**
 * The real install/update action for a single harness. Never creates the
 * harness's base directory itself — if it's absent, this is a pure no-op
 * report (per acceptance criteria: must not create ~/.claude/ or
 * $CODEX_HOME/~/.codex/ itself just to install into it). Otherwise
 * compares real byte content before deciding install / no-op / update, and
 * always reports which of the three distinctly.
 */
export function runInit(harness, home) {
  const detection = detect(harness, home);

  if (detection.state === "no-harness-dir") {
    return {
      ...detection,
      wrote: false,
      message: `No ${harness.label} installation detected (${detection.harnessDir} not found) — nothing to install. No files were changed.`,
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
  mkdirSync(targetSkillDirFor(harness, home), { recursive: true });
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
 * The read-only status check for a single harness. Literally never writes
 * — including on the "stale" path, where agent:init would overwrite but
 * agent:status only reports it.
 */
export function runStatus(harness, home) {
  const detection = detect(harness, home);
  const messages = {
    "no-harness-dir": `No ${harness.label} installation detected (${detection.harnessDir} not found).`,
    "not-installed": `${detection.harnessDir} exists, but the consus skill is not installed (${detection.targetPath} not found). Run "npm run agent:init" to install it.`,
    current: `Installed and up to date: ${detection.targetPath} matches this repo's skills/consus/SKILL.md.`,
    stale: `Installed but stale: ${detection.targetPath} differs from this repo's skills/consus/SKILL.md. Run "npm run agent:init" to update.`,
  };
  return { ...detection, wrote: false, message: messages[detection.state] };
}

/** Parses `node agent-init.mjs <init|status> [--harness <name>]`. Anything
 *  other than a literal "status" positional defaults to "init", matching
 *  the pre-existing behavior this generalizes. */
export function parseArgs(argv) {
  const mode = argv[2] === "status" ? "status" : "init";
  let harnessFilter = null;
  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--harness") {
      harnessFilter = argv[i + 1];
      i++;
    } else if (arg.startsWith("--harness=")) {
      harnessFilter = arg.slice("--harness=".length);
    }
  }
  return { mode, harnessFilter };
}

function main() {
  const { mode, harnessFilter } = parseArgs(process.argv);
  const home = resolveHome();
  const harnesses = selectHarnesses(harnessFilter);
  for (const harness of harnesses) {
    const result = mode === "status" ? runStatus(harness, home) : runInit(harness, home);
    console.log(`[${harness.label}] ${result.message}`);
  }
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
