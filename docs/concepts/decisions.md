# Decisions

A **decision** in Consus is any item in the open queue that carries a `decision_payload` — a structured request for a verdict. The payload format is `dostal:decision-request/v1`.

---

## The `decision-request/v1` shape

```json
{
  "version": "dostal:decision-request/v1",
  "title": "Choose the authentication approach",
  "context": "We need to decide how users authenticate...",
  "options": [
    { "id": "A", "title": "JWT tokens", "tradeoffs": "Stateless, scalable, but revocation is harder." },
    { "id": "B", "title": "Session cookies", "tradeoffs": "Simpler revocation, but requires session store." }
  ],
  "recommended": "A"
}
```

**Required fields:**

| Field | Type | Notes |
|-------|------|-------|
| `version` | `string` | Must be `"dostal:decision-request/v1"` |
| `title` | `string` | One-line summary |
| `context` | `string` | Background and constraints |
| `options` | `array` | At least 2 options, each with `id`, `title`, `tradeoffs` |
| `recommended` | `string` | Must match one of the option `id` values (A–Z) |

---

## Decision types

Beyond the core `decision-request/v1`, Consus supports eight total answer shapes that can appear in the decision queue:

| Type | Description |
|------|-------------|
| `decision-request` | Classic A/B/C options with a recommendation |
| `cba` | Cost-benefit analysis — options with tradeoffs and a recommendation |
| `feature-selection` | Choose which features to include/exclude |
| `edit-proposal` | A proposed change to a doc or diagram |
| `free-text` | Open-ended question requiring a prose answer |
| `rating` | Rate something on a scale |
| `ranking` | Rank a list of items |
| `concept-selection` | Choose between conceptual directions |

All eight shapes flow through the same decision queue and verdict mechanism.

---

## Triage buckets

Each decision is classified into one of three triage buckets based on its content:

- **Structured** — extracted from a well-formed `dostal:decision-request/v1` block in a doc
- **Heuristic** — extracted from prose that looks like a decision but isn't in the structured format
- **External** — pushed directly via `POST /api/decisions` from a harness or external tool

The bucket is recorded as `extractionTier` on the item and visible in the UI.

---

## Submitting a verdict

Four verdict options are available from the UI:

1. **Accept recommendation** — accept the `recommended` option as-is
2. **Choose an option** — pick a different option from the list
3. **Mix options** — combine several options with a custom rationale
4. **Request iteration** — send it back with feedback

Via API:

```bash
POST /api/items/:id/decide
Body: { "actor": "me", "newStatus": "approved" }
```

The server is verdict-shape-agnostic — it records `actor` and `newStatus` to the append-only `audit_log`. The decided item is removed from the active queue and never reappears in `GET /api/decisions`.

---

## Pushing a decision from a harness

A harness can push a new decision directly into the queue:

```bash
POST /api/decisions
Body: {
  "id": "my-unique-stable-id",
  "title": "Choose caching strategy",
  "decision_payload": {
    "version": "dostal:decision-request/v1",
    "title": "Choose caching strategy",
    "context": "...",
    "options": [...],
    "recommended": "A"
  }
}
```

`id` is required and must be stable — a duplicate `id` is rejected with 409. If you re-post the same decision (because your harness doesn't track state), Consus will refuse it. That's deliberate.

See [Agent Integration: Examples](../agent-integration/examples.md) for worked harness examples.

---

## The audit log

Every verdict is written to an append-only `audit_log` table. A decided item never loses its history — the original payload, all intermediate verdicts, and the final decision are all preserved.

`GET /api/items/:id/audit-trail` returns the full history for any item.
