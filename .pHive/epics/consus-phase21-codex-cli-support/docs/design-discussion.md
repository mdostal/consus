# Design Discussion: consus-phase21-codex-cli-support

## Goal

consus-phase19 shipped `npm run agent:init`/`agent:status` for Claude Code, explicitly scoping out
Codex CLI because nobody had confirmed Codex's real skill-discovery mechanism — guessing at it
risked shipping an install step that silently did nothing on a real Codex setup. This epic closes
that gap with a real, confirmed mechanism, extending the existing script rather than replacing it.

## How this was resolved (real verification, not guesswork)

A first research pass (a fork doing web-only research) found Codex CLI has official MCP support
(`codex mcp add`, config in `~/.codex/config.toml`) but could only find **third-party, unconfirmed**
signals for a file-drop skill convention — three independent technical guides describing the same
`~/.codex/AGENTS.md` behavior, but no primary-source quote. Its recommendation: treat Codex support
as a materially bigger, differently-shaped epic (build Consus an MCP server), not a simple
extension.

That conclusion was superseded by a direct, live check against a **real Codex CLI install already
present on this machine** (`codex-cli 0.143.0`, confirmed via `codex --version`). This found:

- `~/.codex/skills/` is a real, existing directory with real content — `.system/skill-creator/`,
  `.system/skill-installer/`, `.system/plugin-creator/`, `.system/openai-docs/`,
  `.system/imagegen/`, each containing a real `SKILL.md` — **the exact same filename convention
  Claude Code uses.**
- Codex's own `skill-installer` system skill (`~/.codex/skills/.system/skill-installer/SKILL.md`)
  **directly documents the install target**, in Codex's own words: *"Installs into
  `$CODEX_HOME/skills/<skill-name>` (defaults to `~/.codex/skills`)."* This is Codex's own
  first-party documentation of its own convention — not a third-party guide, not an inference.
- Frontmatter shape: `name` + `description` (identical to Claude Code's), plus an optional
  `metadata.short-description` field Codex's own skills use for a nicer display name. Consus's
  existing `skills/consus/SKILL.md` (`name: consus` / `description: ...`) already satisfies the
  required fields; adding `metadata.short-description` is a real, cheap enhancement worth doing
  while touching this file, not required for correctness.

**This directly contradicts the web-research-only conclusion.** The MCP surface is real (and stays
out of scope here — Consus still has no MCP server and none is proposed in this epic either,
consistent with consus-phase19's own reasoning), but it is not the *only* real integration surface,
and it is not the one that matches what Consus already does. The file-drop convention this epic
targets is directly analogous to `agent:init`'s existing Claude Code behavior — same filename, same
frontmatter shape, a confirmed install directory.

## Proposed approach

Generalize `scripts/agent-init.mjs` from a single hardcoded Claude Code path into a small
per-harness table, each entry providing: a detection directory (`~/.claude/` for Claude Code;
`$CODEX_HOME` — honoring the real env var Codex itself reads, defaulting to `~/.codex/` — for
Codex), and a skill target path under that directory (`skills/consus/SKILL.md` for both — the
subpath is identical, only the base directory differs). The existing byte-level idempotent
comparison logic (installed / already up to date / updated-was-stale, never creates the base
directory itself) is preserved exactly, just parameterized per harness instead of hardcoded to one.

`npm run agent:init` and `npm run agent:status` run against **every configured harness** by
default (both Claude Code and Codex), reporting each harness's own outcome distinctly — an operator
with only one of the two installed sees a clean "not detected" for the other, not an error. A new
`--harness claude`/`--harness codex` flag (the operator's own cited precedent from Portunus)
narrows to just one, for an operator who only wants to act on one harness at a time.

`HarnessConnectBanner` and the onboarding screen's "Install into harness" copy update to mention
both harnesses are supported, without claiming a mechanism this epic doesn't build (no MCP
mention — that's real but genuinely out of scope here).

## Risks

- **The `metadata.short-description` frontmatter addition is optional polish, not required for
  correctness** — Codex's skill-installer doc doesn't say the field is required, only that its own
  system skills happen to use it. Adding it is low-risk (an extra YAML key any reasonable parser
  ignores if unused) but should be verified not to break Claude Code's own reading of the same file
  (Claude Code already tolerates the file as-is; confirm it still does with the new key present).
- **`$CODEX_HOME` may not be documented as configurable** the way `CLAUDE_HOME`-style overrides
  might or might not exist for Claude Code — this epic's own live check confirmed `$CODEX_HOME` is
  real (it's named directly in Codex's own doc quote above), but the story should still verify this
  behaves correctly (honored when set, defaults to `~/.codex` when unset) exactly the way the
  existing Claude Code path already handles `~/.claude` — no new, divergent pattern.

## Open questions

None outstanding — the one real blocking uncertainty from consus-phase19 (does Codex have a real
mechanism at all) is resolved above with a direct, primary-source citation, not restored guesswork.
