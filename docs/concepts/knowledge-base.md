# Knowledge Base

The **knowledge base (KB)** is Consus's shared-truth store: a collection of approved decisions, docs, and artifacts that future work can be grounded in. When the decision loop closes — when a verdict is accepted and a doc change approved — the result becomes a durable KB entry.

---

## Collections

Every KB entry belongs to a **collection**. Collections group entries by their role in a project:

| Collection | Purpose |
|-----------|---------|
| `boundary-decisions` | Architectural constraints and fixed choices; rarely reopened |
| `plans` | Approved plans and roadmaps |
| `marketing` | Approved positioning, copy, and brand decisions |
| `artifacts` | Approved design artifacts, wireframes, specifications |
| `general` | Everything else |

A collection is not a folder — it is a semantic tag that tells Consus (and any harness querying the KB) what kind of fact it's dealing with.

---

## Draft/publish separation

A KB entry can exist in two states:

- **Draft** — the change is staged, visible in the KB tab, but not yet committed as the authoritative version
- **Published** — the entry is committed; this is the version harnesses see when they query the KB

Draft/publish separation means a pending approval doesn't immediately overwrite the live fact. A human or harness can review the draft before publishing.

---

## Versioning

Every time a KB entry is updated, a new row is written to `kb_versions`. The live entry in `kb_entries` reflects the current published state; the full version history is available via the audit trail.

This means:
- A published decision never loses its prior versions
- You can see what the answer was before the last update
- Rolling back to a prior version is possible (not exposed in the UI yet, but the data is there)

---

## How entries get into the KB

Three paths:

1. **From a verdict** — when a decision item is resolved, Consus optionally promotes it to a KB entry under the `boundary-decisions` or `general` collection
2. **From a doc approval** — an approved edit proposal (`POST /api/proposals/:id/result`) can promote the approved diff to a KB entry
3. **Directly via API** — a harness can write a KB entry directly (see [API Reference](../api/index.md) for the KB routes)

---

## Querying the KB from a harness

The KB routes (under `/api/kb/`) let any harness:

- List all published entries, optionally filtered by collection
- Fetch a specific entry by id
- Write or update an entry
- Read the version history for an entry

This is how a harness that has pushed many decisions can also retrieve the current ground truth — asking "what have we already decided about caching?" before pushing a new decision that might duplicate a settled question.

See [API Reference](../api/index.md) for the full KB route contract.
