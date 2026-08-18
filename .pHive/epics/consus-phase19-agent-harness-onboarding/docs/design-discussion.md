# Design Discussion: consus-phase19-agent-harness-onboarding

## Goal

Every agent/harness that talks to Consus needs a real, discoverable way to get set up and start
interacting — today that means manually finding and reading `skills/consus/SKILL.md`, with no
install step and no visibility in the app itself. This epic adds both halves: a real install/init
action that gets Consus's agent-facing skill onto the operator's machine where Claude Code will
actually find it, and a prominent, collapsible UI panel surfacing that action so it's not buried in
a docs file nobody opens on day one.

## Precedent cited (operator's own words)

A sibling project, Portunus, ships `portunus agent init` — detects Claude Code / Codex CLI on the
machine, registers per-harness, installs its usage skills to `~/.claude/skills/`, is idempotent,
and has a separate `agent status` read-only check. Its README leads with a one-line curl install.
That is real design precedent to learn the *shape* from, not something to port directly — Portunus
is a globally pip/pipx-installed Python CLI tool talking to harnesses over MCP; Consus is a
per-repo Node app with no MCP server, whose actual agent-facing surface is a plain REST API plus a
documented skill file (`skills/consus/SKILL.md`). The right analog for Consus is narrower than
Portunus's own scope, not a straight port.

## Current-state findings

- `skills/consus/SKILL.md` (99 lines) is real, accurate (fixed for staleness in this same branch —
  see the standalone commit ahead of this epic's own docs), and already scoped explicitly to "any
  Claude-Code-compatible agent harness." It documents the decision-queue read/verdict/push contract
  and points to `docs/api-reference.md` for everything else.
- **Real, confirmed convention:** `~/.claude/skills/<name>/SKILL.md` is Claude Code's actual
  user-level skill-discovery location — confirmed directly on this machine (`ls ~/.claude/skills/`
  shows real, currently-installed skills from other projects, including Portunus's own). Dropping
  `skills/consus/SKILL.md` there makes it available to *any* Claude Code session on the machine,
  regardless of which repo/cwd that session is in — not just one running from inside a Consus
  checkout.
- Consus has **no MCP server** and isn't a globally-installed package (no pip/npm-global install
  step exists or is proposed here) — it's cloned per-repo and run via `npm start`. So there is no
  "register an MCP server" step analogous to Portunus's; the entire "install" action for Consus is
  the skill-file drop described above.
- `web/src/App.tsx`'s masthead (`<header className="consus__masthead">`) already hosts the
  `ThemeSkinPicker` and `CommandPalette` — both mounted once, both universal across skins/tabs.
  Directly below the masthead, before `<main>`, is open — the natural mount point for a page-wide
  banner that's visible regardless of active tab.
- The theme/skin system (consus-phase18) already established the exact persistence pattern this
  needs: a namespaced `consus:*` localStorage key, read once on mount, applied/updated via a small
  hook (`useThemePreference`/`useSkinPreference` are the direct precedent to follow, not reinvent).

## Scope decision: Claude Code only for v1

Portunus's own example supports both Claude Code and Codex CLI. Consus's existing skill file is
already explicitly scoped to Claude-Code-compatible harnesses, and Claude Code's file-drop skill
convention is a real, directly-confirmed mechanism on this machine. Codex CLI's own skill/tool
discovery mechanism has not been researched here, and guessing at it risks shipping an install step
that silently does nothing on a real Codex setup. **Resolved: ship real, working Claude Code
support now; treat Codex (or any other harness) as explicit future work, not fabricated scope.**
If the operator wants Codex support, that's a follow-up epic grounded in real research into Codex's
actual mechanism — not assumed here.

## Proposed approach

### 1. A real install/init script (`scripts/agent-init.mjs`)

A small, dependency-free Node script (matches this repo's existing `scripts/start.sh` convention of
plain scripts over a build step), exposed via two new `package.json` scripts:

- `npm run agent:init` — detects whether `~/.claude/` exists on the machine (the real, simple signal
  that Claude Code has been used here at all — matches the precedent's own detection style without
  needing to shell out to the `claude` binary, which the precedent's own build found has a real
  latency problem when done the naive way (`claude mcp list` health-checks every registered server —
  30+ seconds on a machine with many configured; the equivalent trap here would be invoking the
  `claude` CLI at all when a simple filesystem check answers the same question). If found, copies
  `skills/consus/SKILL.md` into `~/.claude/skills/consus/SKILL.md`, creating the directory if
  needed. **Idempotent**: if the destination already has identical content, reports "already
  installed, nothing to do"; if it differs (an older version), overwrites and reports what changed
  as a real diff-aware message, never silently clobbering without saying so.
- `npm run agent:status` — read-only: reports whether `~/.claude/` exists, whether the skill is
  installed, and whether the installed copy matches the current repo's version. Never writes
  anything, safe to run any time.

### 2. A prominent, collapsible UI panel

A new `HarnessConnectBanner` component, mounted in `App.tsx` directly below the masthead (visible
on every tab, not just onboarding) — showing the exact command (`npm run agent:init`), one line on
what it does, and a link to `skills/consus/SKILL.md`/`docs/api-reference.md` for the full contract.
Collapses to a small, persistent, reopenable affordance after the operator dismisses it once — per
the operator's own framing, "collapse it after the first time," not disappear forever. Persisted via
a new namespaced `consus:harness-banner-collapsed` localStorage key, following the exact hook
pattern `useThemePreference`/`useSkinPreference` already established. Renders correctly across all
3 skins (styling per skin, mechanism identical) and both themes — same discipline every other
phase18 surface was held to.

## Risks

- **Idempotency correctness is the one thing that must not slip.** An init script that silently
  overwrites a differently-customized file at `~/.claude/skills/consus/SKILL.md` (if an operator
  ever hand-edited it) would be a real, if minor, data-loss surprise. Mitigation: the script always
  reports what it's about to do (install / already-current / update-from-stale) before writing, and
  the story's acceptance criteria require a real content-comparison, not just an existence check.
- **The banner must not become permanent nag-ware.** "Collapse it after the first time" is explicit
  — the story's acceptance criteria require the collapsed state to actually persist across a reload,
  not re-show every session.
- **Scope creep toward Codex/other harnesses.** Explicitly resolved above — not in this epic.

## Open questions

None outstanding — the one real fork (multi-harness scope) is resolved above with reasoning. If a
new ambiguous call comes up during the story, stop and ask rather than guessing — standing practice.
