# Core Loop

The core loop is Consus's product identity: **index → open → interact → propose → shared-truth KB.**

It is a deliberate cycle, not a dashboard of unrelated capabilities. Each step feeds the next, and the loop closes when a decision or doc change becomes a durable entry in the shared-truth knowledge base.

---

## 1. Index

An operator-triggered, on-demand scan walks a repo's `.pHive/planning/` and `.pHive/epics/**` directories and populates the doc index in SQLite. Not a background poll — nothing scans automatically; this is the only way `doc_index` gets populated or refreshed.

```bash
curl -X POST http://localhost:8722/api/projects/my-repo/ingest
# → { "project": "my-repo", "docsScanned": 21, "eventsCreated": 2 }
```

The scanner resolves doc references across every configured repo — not just the one currently open.

**What gets indexed:**

- `.pHive/planning/**/*.md` and `**/*.html`
- `.pHive/epics/**/*.md`, `**/*.html`, `**/*.yaml`

Files outside these directories are not indexed.

---

## 2. Open

The per-project view shows a project's content together in one place:

- **Diagram cascade** — the epic/story hierarchy derived from `.pHive/epics/**`
- **Architecture diagram** — derived from the repo's directory structure
- **Docs tab** — rendered and browsable docs, grouped by type
- **KB tab** — the knowledge base entries for this project

All of it is live and interactive, not a static render.

---

## 3. Interact

Two interaction modes:

**Doc editing** — read a rendered doc in place; click any section to open the in-place editor. The editor tracks a structured changeset of pending edits before you propose them.

**Diagram editing** — drag nodes, edit labels, add/remove nodes, connect or delete edges directly on the React Flow canvas. The canvas tracks a structured changeset of pending diagram changes alongside a derived (never independently editable) Mermaid source preview.

Both modes converge at the same "Fire to harness" action — a pending change becomes a proposal regardless of whether it came from a doc edit or a diagram manipulation.

---

## 4. Propose

"Fire to harness" sends a `{diff, description}` through the generic `HarnessTransport` (`server/harness/transport.ts`) to whatever local command is configured via `CONSUS_HARNESS_COMMAND`. The harness applies the change and reports back.

Without a configured harness, the proposal is recorded but not applied — it's a no-op on the output side, but the proposal record persists in the DB. A future harness can pick it up.

See [Harness Transport](../agent-integration/harness-transport.md) for how to wire a real command.

---

## 5. Shared-truth KB

An approved decision or doc change becomes a durable, versioned `kb_entries` row — the shared-truth knowledge base.

KB entries are:
- **Append-only** — a decided item never loses history; the audit log is immutable
- **Versioned** — each update creates a new `kb_versions` row alongside the live entry
- **Grouped by collection** — `marketing`, `boundary-decisions`, `plans`, `artifacts`, or `general`
- **Draft/publish separated** — a change can exist as a draft before being committed to the KB

The KB is what makes the loop worthwhile: future decisions can be grounded in what's already been decided, rather than re-litigating closed questions.

See [Knowledge Base concepts](knowledge-base.md) for more on how collections, drafts, and versioning work.

---

## Why the loop is deliberate

Consus is not a ticket tracker, a CI dashboard, or a dispatcher for other systems. The loop is intentionally narrow: index a repo's own planning docs, surface the open questions, make it easy to interact with and propose changes, and record what was decided.

The loop does not extend into polling for changes, automatically applying proposals, or reaching out to any external system. Those integrations belong one layer up — in a harness or adapter that talks to Consus over the same generic HTTP seams any other caller would use.
