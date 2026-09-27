# Harness Transport

`HarnessTransport` (`server/harness/transport.ts`) is Consus's sole integration seam for the "propose a change and let something apply it" mechanism. It is generic by design — it has no knowledge of what's on the other end.

---

## Configuration

Set two environment variables to enable the harness:

```bash
CONSUS_HARNESS_COMMAND=<executable>        # required to enable
CONSUS_HARNESS_ARGS=<comma-separated args> # optional
```

Without `CONSUS_HARNESS_COMMAND`, all "Fire to harness" actions are no-ops: the proposal is recorded in the DB but never sent anywhere.

### Example: Claude Code

```bash
CONSUS_HARNESS_COMMAND=claude
CONSUS_HARNESS_ARGS=--no-stream
```

Or use the built-in skill install:

```bash
npm run agent:init
```

This installs `skills/consus/SKILL.md` into `~/.claude/skills/consus/` so any Claude Code session on this machine can read and act on the decision queue — the harness side is the Claude Code session itself.

---

## The stdio protocol

When a proposal is fired, `HarnessTransport` invokes the configured command with:

1. The command and args from `CONSUS_HARNESS_COMMAND`/`CONSUS_HARNESS_ARGS`
2. A JSON payload written to the process's **stdin**
3. The harness writes a JSON response to **stdout**
4. `HarnessTransport` reads stdout and records the result in `proposals`

### Proposal payload (sent to harness stdin)

```json
{
  "method": "apply_proposal",
  "params": {
    "id": "<proposal-id>",
    "type": "doc_edit" | "diagram_edit",
    "diff": "<unified diff string>",
    "description": "<human-readable description of the change>",
    "repo": "<project name>",
    "path": "<file path, for doc edits>"
  }
}
```

### Result payload (expected from harness stdout)

```json
{
  "ok": true | false,
  "message": "<what the harness did>",
  "appliedAt": "<ISO timestamp>"
}
```

A non-zero exit code or stdout that doesn't parse as JSON is recorded as a failure — the proposal row is updated with `status: "failed"` and the raw stdout/stderr.

---

## Proposal lifecycle

Proposals flow through `POST /api/proposals`:

```bash
POST /api/proposals
Body: {
  "itemId": "<the item this proposal is for>",
  "type": "doc_edit",
  "diff": "...",
  "description": "..."
}
# → 201 { "id": "<proposal-id>", "status": "pending" }
```

The UI calls this automatically when you click "Fire to harness." The harness result is written back via:

```bash
POST /api/proposals/:id/result
Body: { "ok": true, "message": "Applied.", "appliedAt": "2026-09-15T12:00:00Z" }
# → 200 { "ok": true }
```

`status` transitions: `pending` → `applied` (on success) or `failed` (on error).

---

## Fixed boundaries

- `HarnessTransport` is the **only** integration seam for the propose-a-change mechanism
- It defaults to a no-op with no knowledge of what's configured
- The codebase does not grow a client for any specific external system — if an integration is needed, it lives one layer up and reaches Consus over these same generic seams
